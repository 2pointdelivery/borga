import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL is not set in environment.');
    process.exit(1);
  }

  try {
    const connection = await mysql.createConnection(dbUrl);
    console.log('Clearing database tables...');
    
    // Disable foreign key checks for robustness during truncation
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    
    await connection.query('TRUNCATE TABLE borga_users');
    await connection.query('TRUNCATE TABLE borga_state');
    
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    
    console.log('Database tables cleared successfully via direct TRUNCATE.');
    
    await connection.end();
    process.exit(0);
  } catch (error) {
    console.error('Failed to clear database:', error);
    process.exit(1);
  }
}

main();
