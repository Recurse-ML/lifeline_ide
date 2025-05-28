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
				this.updateConfiguration();
				if (prevIsEnabled !== this._isLineSurvivalEnabled) {
					if (this._isLineSurvivalEnabled) {
						this.updateLineSurvival();
					} else {
						this.removeAllDecorations();
					}
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
		// Create a gradient from red (low) to yellow (medium) to green (high)
		let backgroundColor: string;

		if (probability >= 0.7) {
			// High probability - green tint
			const intensity = Math.min(0.3, (probability - 0.7) / 0.3 * 0.3);
			backgroundColor = `rgba(0, 255, 0, ${intensity})`;
		} else if (probability >= 0.4) {
			// Medium probability - yellow tint
			const intensity = Math.min(0.3, (probability - 0.4) / 0.3 * 0.3);
			backgroundColor = `rgba(255, 255, 0, ${intensity})`;
		} else {
			// Low probability - red tint
			const intensity = Math.min(0.3, (0.4 - probability) / 0.4 * 0.3);
			backgroundColor = `rgba(255, 0, 0, ${intensity})`;
		}

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
