#!/usr/bin/env python3
"""
Stable Diffusion Inference Script
"""

import argparse
import sys
import time
import base64
from io import BytesIO
from PIL import Image
from diffusers import StableDiffusionPipeline
import torch

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    
    start_time = time.time()
    
    try:
        # Load model
        print("Loading Stable Diffusion...", file=sys.stderr)
        pipe = StableDiffusionPipeline.from_pretrained(
            "runwayml/stable-diffusion-v1-5",
            torch_dtype=torch.float16
        )
        pipe = pipe.to("cuda" if torch.cuda.is_available() else "cpu")
        
        # Read prompt
        with open(args.input, 'r') as f:
            prompt = f.read()
        
        # Generate image
        print("Generating image...", file=sys.stderr)
        image = pipe(prompt, num_inference_steps=20).images[0]
        
        # Save as base64
        buffered = BytesIO()
        image.save(buffered, format="PNG")
        img_str = base64.b64encode(buffered.getvalue()).decode()
        
        # Write output
        with open(args.output, 'w') as f:
            f.write(img_str)
        
        elapsed = (time.time() - start_time) * 1000
        print(f"Completed in {elapsed:.2f}ms", file=sys.stderr)
        
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()

