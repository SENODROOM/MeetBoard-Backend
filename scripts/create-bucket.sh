#!/bin/bash

# Wait for MinIO to be ready
echo "Waiting for MinIO to be ready..."
sleep 10

# Configure MinIO client
mc alias set myminio http://minio:9000 $MINIO_ROOT_USER $MINIO_ROOT_PASSWORD

# Create bucket
mc mb myminio/rtc-files --ignore-existing

# Set bucket policy (optional - for public read access)
# mc anonymous set download myminio/rtc-files

echo "MinIO bucket created successfully!"
