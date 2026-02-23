const { Pool } = require('pg');

const pool = new Pool({
    connectionString: 'postgresql://rtc_user@127.0.0.1:5432/rtc_app',
});

pool.query('SELECT 1 as test', (err, res) => {
    if (err) {
        console.error('Error:', err.message);
    } else {
        console.log('Success!', res.rows);
    }
    pool.end();
});
