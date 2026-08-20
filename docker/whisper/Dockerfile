FROM python:3.10-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy inference script
COPY infer.py .

ENV MAX_MEMORY=2G
ENV MAX_CPUS=2
ENV TIMEOUT=30

CMD ["python", "infer.py"]

