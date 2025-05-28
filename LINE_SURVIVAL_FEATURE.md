# Line Survival Probability Feature

This feature adds line survival probability prediction to VSCode. It sends the content of all lines in the currently open file to a remote machine learning endpoint and displays color-coded backgrounds based on the returned probability scores.

## How it Works

1. **Data Collection**: When a file is opened or modified, the feature extracts all line content from the current file
2. **API Call**: The lines are sent to a configurable remote endpoint via HTTP POST
3. **Visualization**: Each line gets a colored background based on its survival probability:
   - **Red tint**: Low probability (0.0 - 0.4) - lines likely to be changed/removed
   - **Yellow tint**: Medium probability (0.4 - 0.7) - lines with moderate stability
   - **Green tint**: High probability (0.7 - 1.0) - lines likely to survive future commits

## Configuration

The feature can be configured through VSCode settings:

```json
{
  "editor.lineSurvival.enabled": true,
  "editor.lineSurvival.endpoint": "http://localhost:8080/predict"
}
```

### Settings

- `editor.lineSurvival.enabled` (boolean, default: `true`): Enable/disable the line survival feature
- `editor.lineSurvival.endpoint` (string, default: `"http://localhost:8080/predict"`): The URL of the machine learning endpoint

## API Specification

The remote endpoint should accept POST requests with the following format:

### Request
```json
{
  "lines": [
    "import React from 'react';",
    "",
    "function MyComponent() {",
    "  return <div>Hello World</div>;",
    "}"
  ]
}
```

### Response
```json
{
  "probabilities": [0.85, 0.2, 0.75, 0.6, 0.8]
}
```

The `probabilities` array must contain exactly one float value (0.0 to 1.0) for each line in the request.

## Testing with Mock Server

A mock server is provided for testing purposes:

1. **Start the mock server**:
   ```bash
   python3 mock-line-survival-server.py
   ```

2. **Open VSCode** with your fork and open any file

3. **Observe the colored backgrounds** on each line based on the mock predictions

The mock server generates probabilities based on simple heuristics:
- Empty lines: Low probability (0.1-0.3)
- Comments: Low-medium probability (0.2-0.5)
- Import statements: High probability (0.7-0.9)
- Function/class definitions: Medium-high probability (0.6-0.8)
- Regular code: Medium probability (0.3-0.7)

## Implementation Details

### Files Added/Modified

1. **`src/vs/editor/contrib/lineSurvival/browser/lineSurvivalContribution.ts`**: Main contribution class
2. **`src/vs/editor/contrib/lineSurvival/browser/lineSurvival.contribution.ts`**: Registration file
3. **`src/vs/editor/editor.all.ts`**: Added import for the new contribution
4. **`mock-line-survival-server.py`**: Mock server for testing

### Key Features

- **Debounced Updates**: API calls are debounced (2 second delay) to avoid excessive requests during typing
- **Dynamic CSS**: Uses VSCode's dynamic CSS system for efficient background color rendering
- **Error Handling**: Gracefully handles API failures and network errors
- **Performance**: Minimal impact on editor performance through efficient decoration management
- **Configurable**: Fully configurable endpoint and enable/disable toggle

### Architecture

The feature follows VSCode's contribution pattern:
1. Implements `IEditorContribution` interface
2. Registers with `EditorContributionInstantiation.AfterFirstRender`
3. Uses `IEditorDecorationsCollection` for efficient decoration management
4. Leverages `DynamicCssRules` for background color styling
5. Integrates with VSCode's configuration system

## Future Enhancements

Potential improvements for the feature:
- **Caching**: Cache predictions to reduce API calls
- **File Type Filtering**: Enable/disable based on file type
- **Custom Color Schemes**: Allow users to customize the color gradient
- **Hover Information**: Show exact probability values on hover
- **Batch Processing**: Support for multiple files
- **Offline Mode**: Local model support for offline predictions
