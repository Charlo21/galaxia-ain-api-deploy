#!/usr/bin/env python3
"""
Whisper Speech-to-Text Inference Script
"""

import argparse
import sys
import time
import base64
import tempfile
import os
from whisper import load_model

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    
    start_time = time.time()
    
    try:
        # Load model
        print("Loading Whisper...", file=sys.stderr)
        model = load_model("base")
        
        # Decode base64 audio
        with open(args.input, 'rb') as f:
            audio_data = base64.b64decode(f.read())
        
        # Save to temp file
        with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as tmp:
            tmp.write(audio_data)
            tmp_path = tmp.name
        
        try:
            # Transcribe
            print("Transcribing...", file=sys.stderr)
            result = model.transcribe(tmp_path)
            text = result["text"]
            
            # Write output
            with open(args.output, 'w') as f:
                f.write(text)
            
            elapsed = (time.time() - start_time) * 1000
            print(f"Completed in {elapsed:.2f}ms", file=sys.stderr)
        finally:
            os.unlink(tmp_path)
        
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()

