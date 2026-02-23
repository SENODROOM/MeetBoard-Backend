const { execSync } = require('child_process');

try {
    execSync('docker --version', { stdio: 'pipe' });
    console.log('✓ Docker is available');
    process.exit(0);
} catch (error) {
    console.error('❌ Docker is not running!');
    console.error('\nPlease:');
    console.error('1. Open Docker Desktop');
    console.error('2. Wait for it to start');
    console.error('3. Run this command again\n');
    process.exit(1);
}
