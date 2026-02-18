#!/bin/bash

echo "Setting up Real-Time Communication Backend..."

# Check if .env exists
if [ ! -f .env ]; then
    echo "Creating .env file from .env.example..."
    cp .env.example .env
    echo "Please update .env with your configuration!"
fi

# Install dependencies
echo "Installing dependencies..."
npm install

# Wait for databases to be ready
echo "Waiting for databases to be ready..."
sleep 5

# Run migrations
echo "Running database migrations..."
npm run migrate

echo "Setup complete!"
echo "Run 'npm run dev' to start the development server"
