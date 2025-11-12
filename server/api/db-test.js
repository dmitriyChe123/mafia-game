import { Pool } from 'pg';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

export default async function handler(req, res) {
    try {
        const result = await pool.query('SELECT NOW()');
        res.status(200).json({ dbTime: result.rows[0].now });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}