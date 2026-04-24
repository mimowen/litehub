// 测试脚本 - 验证最新部署的LiteHub API功能
import fetch from 'node-fetch';

// 使用最新部署的URL
const API_URL = 'https://litehub-9n7eq53ks-wens-projects-0631aaf3.vercel.app/api';

async function testAPI() {
  console.log('=== 测试最新部署的 LiteHub API ===\n');
  
  const endpoints = [
    '/',
    '/agents',
    '/queues',
    '/skill',
    '/dashboard'
  ];
  
  for (const endpoint of endpoints) {
    console.log(`测试: ${endpoint}`);
    try {
      const response = await fetch(`${API_URL}${endpoint}`);
      const status = response.status;
      let data;
      
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }
      
      console.log(`状态码: ${status}`);
      if (typeof data === 'object') {
        console.log('响应:', JSON.stringify(data, null, 2));
      } else {
        console.log('响应长度:', data.length, '字符');
        console.log('前200字符:', data.substring(0, 200) + '...');
      }
    } catch (error) {
      console.error('错误:', error.message);
    }
    console.log('');
  }
  
  console.log('=== 测试完成 ===');
}

testAPI();