#!/usr/bin/env python3
"""
Mock server for line survival probability prediction.
Returns random probabilities for each line to test the VSCode feature.
"""

import json
import random
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

class LineSurvivalHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/predict':
            # Read the request body
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)

            try:
                # Parse the JSON request
                request_data = json.loads(post_data.decode('utf-8'))
                lines = request_data.get('lines', [])

                # Generate random probabilities for each line
                # In a real implementation, this would be ML model predictions
                probabilities = []
                for line in lines:
                    # Generate probabilities based on some simple heuristics for demo
                    if not line.strip():  # Empty lines have low survival
                        prob = random.uniform(0.1, 0.3)
                    elif line.strip().startswith('//') or line.strip().startswith('#'):  # Comments
                        prob = random.uniform(0.2, 0.5)
                    elif 'import' in line or 'from' in line:  # Import statements
                        prob = random.uniform(0.7, 0.9)
                    elif 'function' in line or 'def ' in line or 'class ' in line:  # Function/class definitions
                        prob = random.uniform(0.6, 0.8)
                    else:  # Regular code
                        prob = random.uniform(0.3, 0.7)

                    probabilities.append(round(prob, 3))

                # Send response
                response = {
                    'probabilities': probabilities
                }

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
                self.send_header('Access-Control-Allow-Headers', 'Content-Type')
                self.end_headers()

                self.wfile.write(json.dumps(response).encode('utf-8'))

            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                error_response = {'error': str(e)}
                self.wfile.write(json.dumps(error_response).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        # Handle CORS preflight requests
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

def run_server(port=8080):
    server_address = ('', port)
    httpd = HTTPServer(server_address, LineSurvivalHandler)
    print(f"Mock Line Survival Server running on http://localhost:{port}")
    print("Endpoint: POST /predict")
    print("Expected payload: {\"lines\": [\"line1\", \"line2\", ...]}")
    print("Response: {\"probabilities\": [0.1, 0.8, ...]}")
    print("\nPress Ctrl+C to stop the server")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
        httpd.server_close()

if __name__ == '__main__':
    run_server()
