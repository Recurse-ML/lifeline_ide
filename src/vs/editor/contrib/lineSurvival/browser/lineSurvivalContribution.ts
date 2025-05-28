/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancelablePromise, createCancelablePromise, TimeoutTimer } from '../../../../base/common/async.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ICodeEditor } from '../../../browser/editorBrowser.js';
import { DynamicCssRules } from '../../../browser/editorDom.js';
import { EditorContributionInstantiation, registerEditorContribution } from '../../../browser/editorExtensions.js';
import { IEditorContribution, IEditorDecorationsCollection } from '../../../common/editorCommon.js';
import { IModelDeltaDecoration, TrackedRangeStickiness } from '../../../common/model.js';
import { ModelDecorationOptions } from '../../../common/model/textModel.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';

interface ILineSurvivalData {
	lineNumber: number;
	probability: number;
}

export class LineSurvivalContribution extends Disposable implements IEditorContribution {

	public static readonly ID: string = 'editor.contrib.lineSurvival';

	static readonly RECOMPUTE_TIME = 2000; // ms

	private readonly _localToDispose = this._register(new DisposableStore());
	private _computePromise: CancelablePromise<ILineSurvivalData[]> | null;
	private _timeoutTimer: TimeoutTimer | null;

	private readonly _decorationsCollection: IEditorDecorationsCollection;
	private readonly _ruleFactory: DynamicCssRules;
	private readonly _cssClassRefs = this._register(new DisposableStore());

	private _isLineSurvivalEnabled: boolean = true;
	private _endpoint: string = 'http://localhost:8080/predict';
	private _debounceMs: number = 1000;
	private _colorIntensity: number = 0.15;
	private _colorStyle: string = 'subtle';

	constructor(
		private readonly _editor: ICodeEditor,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) {
		super();
		this._decorationsCollection = this._editor.createDecorationsCollection();
		this._ruleFactory = new DynamicCssRules(this._editor);

		this._register(_editor.onDidChangeModel(() => {
			this.updateConfiguration();
			this.updateLineSurvival();
		}));

		this._register(_editor.onDidChangeModelLanguage(() => this.updateLineSurvival()));

		this._register(_editor.onDidChangeConfiguration((e) => {
			const prevIsEnabled = this._isLineSurvivalEnabled;
			this.updateConfiguration();
			if (prevIsEnabled !== this._isLineSurvivalEnabled) {
				if (this._isLineSurvivalEnabled) {
					this.updateLineSurvival();
				} else {
					this.removeAllDecorations();
				}
			}
		}));

		this._register(this._configurationService.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('editor.lineSurvival')) {
				const prevIsEnabled = this._isLineSurvivalEnabled;
				const prevColorIntensity = this._colorIntensity;
				const prevColorStyle = this._colorStyle;

				this.updateConfiguration();

				if (prevIsEnabled !== this._isLineSurvivalEnabled) {
					if (this._isLineSurvivalEnabled) {
						this.updateLineSurvival();
					} else {
						this.removeAllDecorations();
					}
				} else if (this._isLineSurvivalEnabled &&
					(prevColorIntensity !== this._colorIntensity || prevColorStyle !== this._colorStyle)) {
					// Color settings changed, trigger a redraw with current data
					this.beginCompute();
				}
			}
		}));

		this._timeoutTimer = null;
		this._computePromise = null;
		this.updateConfiguration();
		this.updateLineSurvival();
	}

	private updateConfiguration(): void {
		const model = this._editor.getModel();
		const resource = model?.uri;

		this._isLineSurvivalEnabled = this._configurationService.getValue<boolean>('editor.lineSurvival.enabled', { resource }) ?? true;
		this._endpoint = this._configurationService.getValue<string>('editor.lineSurvival.endpoint', { resource }) ?? 'http://localhost:8080/predict';
		this._debounceMs = this._configurationService.getValue<number>('editor.lineSurvival.debounceMs', { resource }) ?? 1000;
		this._colorIntensity = this._configurationService.getValue<number>('editor.lineSurvival.colorIntensity', { resource }) ?? 0.15;
		this._colorStyle = this._configurationService.getValue<string>('editor.lineSurvival.colorStyle', { resource }) ?? 'subtle';
	}

	isEnabled(): boolean {
		const model = this._editor.getModel();
		if (!model) {
			return false;
		}
		return this._isLineSurvivalEnabled;
	}

	static get(editor: ICodeEditor): LineSurvivalContribution | null {
		return editor.getContribution<LineSurvivalContribution>(this.ID);
	}

	override dispose(): void {
		this.stop();
		this.removeAllDecorations();
		super.dispose();
	}

	private updateLineSurvival(): void {
		this.stop();

		if (!this._isLineSurvivalEnabled) {
			return;
		}

		const model = this._editor.getModel();
		if (!model) {
			return;
		}

		this._localToDispose.add(this._editor.onDidChangeModelContent(() => {
			if (!this._timeoutTimer) {
				this._timeoutTimer = new TimeoutTimer();
				this._timeoutTimer.cancelAndSet(() => {
					this._timeoutTimer = null;
					this.beginCompute();
				}, this._debounceMs);
			}
		}));

		this.beginCompute();
	}

	private async beginCompute(): Promise<void> {
		this._computePromise = createCancelablePromise(async token => {
			const model = this._editor.getModel();
			if (!model) {
				return [];
			}

			const lines = [];
			const lineCount = model.getLineCount();
			for (let i = 1; i <= lineCount; i++) {
				lines.push(model.getLineContent(i));
			}

			try {
				const response = await this.callLineSurvivalAPI(lines);
				return response.map((probability, index) => ({
					lineNumber: index + 1,
					probability
				}));
			} catch (error) {
				console.error('Failed to get line survival predictions:', error);
				return [];
			}
		});

		try {
			const lineSurvivalData = await this._computePromise;
			this.updateDecorations(lineSurvivalData);
			this._computePromise = null;
		} catch (e) {
			onUnexpectedError(e);
		}
	}

	private async callLineSurvivalAPI(lines: string[]): Promise<number[]> {
		const response = await fetch(this._endpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ lines }),
		});

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		const data = await response.json();
		return data.probabilities || [];
	}

	private updateDecorations(lineSurvivalData: ILineSurvivalData[]): void {
		// Clear previous CSS class references
		this._cssClassRefs.clear();

		const decorations: IModelDeltaDecoration[] = [];

		for (const data of lineSurvivalData) {
			const decorationOptions = this.getDecorationOptions(data.probability);
			if (decorationOptions) {
				decorations.push({
					range: {
						startLineNumber: data.lineNumber,
						startColumn: 1,
						endLineNumber: data.lineNumber,
						endColumn: Number.MAX_SAFE_INTEGER
					},
					options: decorationOptions
				});
			}
		}

		this._decorationsCollection.set(decorations);
	}

	private getDecorationOptions(probability: number): ModelDecorationOptions | null {
		const backgroundColor = this.getBackgroundColor(probability);

		// Create a dynamic CSS class for this specific background color
		const cssClassRef = this._cssClassRefs.add(
			this._ruleFactory.createClassNameRef({
				backgroundColor: backgroundColor
			})
		);

		return ModelDecorationOptions.createDynamic({
			description: 'lineSurvival',
			className: cssClassRef.className,
			isWholeLine: true,
			stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
		});
	}

	private getBackgroundColor(probability: number): string {
		// Normalize probability to 0-1 range and apply intensity scaling
		const normalizedProbability = Math.max(0, Math.min(1, probability));
		const intensity = this._colorIntensity;

		switch (this._colorStyle) {
			case 'monochrome':
				return this.getMonochromeColor(normalizedProbability, intensity);
			case 'vibrant':
				return this.getVibrantColor(normalizedProbability, intensity);
			case 'subtle':
			default:
				return this.getSubtleColor(normalizedProbability, intensity);
		}
	}

	private getSubtleColor(probability: number, intensity: number): string {
		// Use muted, theme-aware colors that are easier on the eyes
		if (probability >= 0.7) {
			// High survival - soft green with blue undertones
			const alpha = intensity * (0.5 + (probability - 0.7) / 0.3 * 0.5);
			return `rgba(46, 125, 50, ${alpha})`; // Material Design Green 700 with low alpha
		} else if (probability >= 0.4) {
			// Medium survival - warm amber
			const alpha = intensity * (0.5 + (probability - 0.4) / 0.3 * 0.5);
			return `rgba(255, 143, 0, ${alpha})`; // Material Design Orange 500 with low alpha
		} else {
			// Low survival - muted red
			const alpha = intensity * (0.5 + (0.4 - probability) / 0.4 * 0.5);
			return `rgba(198, 40, 40, ${alpha})`; // Material Design Red 700 with low alpha
		}
	}

	private getVibrantColor(probability: number, intensity: number): string {
		// Original bright colors but with configurable intensity
		if (probability >= 0.7) {
			const alpha = intensity * (0.5 + (probability - 0.7) / 0.3 * 0.5);
			return `rgba(0, 255, 0, ${alpha})`;
		} else if (probability >= 0.4) {
			const alpha = intensity * (0.5 + (probability - 0.4) / 0.3 * 0.5);
			return `rgba(255, 255, 0, ${alpha})`;
		} else {
			const alpha = intensity * (0.5 + (0.4 - probability) / 0.4 * 0.5);
			return `rgba(255, 0, 0, ${alpha})`;
		}
	}

	private getMonochromeColor(probability: number, intensity: number): string {
		// Grayscale colors for minimal distraction
		if (probability >= 0.7) {
			// High survival - light gray
			const alpha = intensity * (0.3 + (probability - 0.7) / 0.3 * 0.4);
			return `rgba(200, 200, 200, ${alpha})`;
		} else if (probability >= 0.4) {
			// Medium survival - medium gray
			const alpha = intensity * (0.3 + (probability - 0.4) / 0.3 * 0.4);
			return `rgba(150, 150, 150, ${alpha})`;
		} else {
			// Low survival - darker gray
			const alpha = intensity * (0.3 + (0.4 - probability) / 0.4 * 0.4);
			return `rgba(100, 100, 100, ${alpha})`;
		}
	}

	private stop(): void {
		if (this._timeoutTimer) {
			this._timeoutTimer.cancel();
			this._timeoutTimer = null;
		}
		if (this._computePromise) {
			this._computePromise.cancel();
			this._computePromise = null;
		}
		this._localToDispose.clear();
	}

	private removeAllDecorations(): void {
		this._decorationsCollection.clear();
	}
}

registerEditorContribution(LineSurvivalContribution.ID, LineSurvivalContribution, EditorContributionInstantiation.AfterFirstRender);
