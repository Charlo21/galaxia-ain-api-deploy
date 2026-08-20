#!/usr/bin/env python3
"""
Llama 3 8B Inference Script
Runs in Docker container with resource limits
"""

import argparse
import sys
import time
from transformers import AutoTokenizer, AutoModelForCausalLM
import torch

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    
    start_time = time.time()
    
    try:
        # Load model (in production, this would be pre-downloaded)
        print("Loading model...", file=sys.stderr)
        tokenizer = AutoTokenizer.from_pretrained("meta-llama/Meta-Llama-3-8B")
        model = AutoModelForCausalLM.from_pretrained(
            "meta-llama/Meta-Llama-3-8B",
            torch_dtype=torch.float16,
            device_map="auto"
        )
        
        # Read input
        with open(args.input, 'r') as f:
            input_text = f.read()
        
        # Generate
        print("Generating...", file=sys.stderr)
        inputs = tokenizer(input_text, return_tensors="pt")
        outputs = model.generate(
            inputs.input_ids,
            max_length=512,
            temperature=0.7,
            do_sample=True
        )
        
        result = tokenizer.decode(outputs[0], skip_special_tokens=True)
        
        # Write output
        with open(args.output, 'w') as f:
            f.write(result)
        
        elapsed = (time.time() - start_time) * 1000
        print(f"Completed in {elapsed:.2f}ms", file=sys.stderr)
        
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()

