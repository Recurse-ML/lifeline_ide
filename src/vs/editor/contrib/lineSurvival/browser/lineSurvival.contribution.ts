/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from '../../../../platform/registry/common/platform.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry, ConfigurationScope } from '../../../../platform/configuration/common/configurationRegistry.js';
import { editorConfigurationBaseNode } from '../../../common/config/editorConfigurationSchema.js';
import * as nls from '../../../../nls.js';

import './lineSurvivalContribution.js';

// Register configuration settings
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	...editorConfigurationBaseNode,
	properties: {
		'editor.lineSurvival.enabled': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
			markdownDescription: nls.localize('lineSurvival.enabled', 'Enable/disable line survival probability prediction. When enabled, lines are color-coded based on their predicted probability of surviving future commits.')
		},
		'editor.lineSurvival.endpoint': {
			type: 'string',
			default: 'http://localhost:8080/predict',
			scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
			markdownDescription: nls.localize('lineSurvival.endpoint', 'The URL endpoint for the line survival prediction service. The service should accept POST requests with line content and return probability scores.')
		},
		'editor.lineSurvival.debounceMs': {
			type: 'number',
			default: 1000,
			minimum: 100,
			maximum: 10000,
			scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
			markdownDescription: nls.localize('lineSurvival.debounceMs', 'Delay in milliseconds before sending line content to the prediction service after the last edit. Higher values reduce API calls but increase latency.')
		},
		'editor.lineSurvival.colorIntensity': {
			type: 'number',
			default: 0.15,
			minimum: 0.05,
			maximum: 0.5,
			scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
			markdownDescription: nls.localize('lineSurvival.colorIntensity', 'Controls the intensity of the background colors for line survival predictions. Lower values create more subtle highlighting that is easier on the eyes.')
		},
		'editor.lineSurvival.colorStyle': {
			type: 'string',
			enum: ['subtle', 'vibrant', 'monochrome'],
			default: 'subtle',
			scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
			markdownDescription: nls.localize('lineSurvival.colorStyle', 'Color style for line survival predictions. "subtle" uses muted theme-aware colors, "vibrant" uses bright colors, "monochrome" uses grayscale.')
		}
	}
});
