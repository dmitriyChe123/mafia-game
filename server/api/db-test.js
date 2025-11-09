import { Pool } from 'pg';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

export default async function handler(req, res) {
    const { rows } = await pool.query('SELECT NOW()');
    res.status(200).json({ time: rows[0].now });
}
