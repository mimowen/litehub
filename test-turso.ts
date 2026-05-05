// test-turso.ts - 测试 Turso 数据库连接
import { getDbClient } from './src/adapters/db/turso.js';

async function test() {
  try {
    console.log('Testing Turso connection...');
    const db = await getDbClient();
    console.log('✅ Database client created');
    
    const result = await db.execute('SELECT 1 as test');
    console.log('✅ Query executed:', result);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

test();
