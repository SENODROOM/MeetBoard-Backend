const { execSync } = require('child_process');
const path = require('path');

console.log('========================================');
console.log('Starting Docker Services');
console.log('========================================\n');

// Check if Docker is running
function isDockerRunning() {
    try {
        execSync('docker ps', { stdio: 'pipe' });
        return true;
    } catch (error) {
        return false;
    }
}

// Sleep function
function sleep(seconds) {
    const start = Date.now();
    while (Date.now() - start < seconds * 1000) {
        // Busy wait
    }
}

try {
    // Check if Docker is installed
    console.log('Checking Docker installation...');
    execSync('docker --version', { stdio: 'inherit' });
    console.log('✓ Docker is installed\n');

    // Check if Docker is running
    if (!isDockerRunning()) {
        console.log('❌ Docker Desktop is NOT running!\n');
        console.log('Please:');
        console.log('1. Open Docker Desktop application');
        console.log('2. Wait for it to show "Docker Desktop is running"');
        console.log('3. Run this command again\n');
        console.log('Waiting 60 seconds for Docker to start...\n');

        // Wait up to 60 seconds
        for (let i = 0; i < 30; i++) {
            if (isDockerRunning()) {
                console.log('\n✓ Docker Desktop is now running!\n');
                break;
            }
            process.stdout.write(`Waiting... ${i * 2}s\r`);
            sleep(2);
        }

        if (!isDockerRunning()) {
            console.error('\n❌ Docker Desktop did not start.');
            console.error('Please start Docker Desktop manually and try again.\n');
            process.exit(1);
        }
    } else {
        console.log('✓ Docker Desktop is running\n');
    }

    // Navigate to project root
    const projectRoot = path.join(__dirname, '../..');
    process.chdir(projectRoot);

    // Stop any existing containers (ignore errors)
    console.log('Stopping existing containers...');
    try {
        execSync('docker-compose down', { stdio: 'pipe' });
        console.log('✓ Stopped existing containers\n');
    } catch (e) {
        console.log('✓ No existing containers to stop\n');
    }

    // Start Docker services
    console.log('Starting PostgreSQL, MongoDB, Redis, and MinIO...');
    console.log('This may take 1-2 minutes on first run...\n');

    execSync('docker-compose up -d postgres mongodb redis minio', {
        stdio: 'inherit',
        cwd: projectRoot
    });

    console.log('\n✓ Services started!\n');

    console.log('Waiting for services to be ready (30 seconds)...');
    sleep(30);

    // Initialize database
    console.log('\nInitializing database...');
    try {
        execSync('docker-compose exec -T postgres psql -U rtc_user -d rtc_app < backend/scripts/init-db.sql', {
            stdio: 'pipe',
            cwd: projectRoot
        });
        console.log('✓ Database initialized\n');
    } catch (e) {
        console.log('⚠ Database may already be initialized\n');
    }

    // Create MinIO bucket
    console.log('Setting up storage...');
    try {
        execSync('docker-compose exec -T minio mc alias set myminio http://localhost:9000 admin SecurePassword123!', {
            stdio: 'pipe',
            cwd: projectRoot
        });
        execSync('docker-compose exec -T minio mc mb myminio/rtc-files --ignore-existing', {
            stdio: 'pipe',
            cwd: projectRoot
        });
        console.log('✓ Storage ready\n');
    } catch (e) {
        console.log('⚠ Storage may already be configured\n');
    }

    console.log('========================================');
    console.log('✓ All services are ready!');
    console.log('========================================\n');
    console.log('PostgreSQL: localhost:5432');
    console.log('MongoDB: localhost:27017');
    console.log('Redis: localhost:6379');
    console.log('MinIO: localhost:9000\n');
    console.log('Starting backend server...\n');

} catch (error) {
    console.error('\n❌ Error starting Docker services:');
    console.error(error.message);
    console.error('\nTroubleshooting:');
    console.error('1. Make sure Docker Desktop is running');
    console.error('2. Try restarting Docker Desktop');
    console.error('3. Run: docker ps (to test Docker)');
    console.error('4. Check Docker Desktop settings\n');
    process.exit(1);
}
