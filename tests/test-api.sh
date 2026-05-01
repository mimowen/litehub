#!/bin/bash
# LiteHub API 测试脚本
# 用法: ./test-api.sh [base_url]
# 示例: ./test-api.sh http://localhost:3000
#       ./test-api.sh https://your-litehub.vercel.app

set -e

BASE_URL="${1:-http://localhost:3000}"
PASS=0
FAIL=0

echo "=========================================="
echo "LiteHub API 测试"
echo "目标: $BASE_URL"
echo "=========================================="
echo ""

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

test_endpoint() {
    local method=$1
    local path=$2
    local name=$3
    local expected_status=${4:-200}
    local data=$5
    
    printf "Testing %-10s %-30s ... " "$method" "$name"
    
    if [ -n "$data" ]; then
        response=$(curl -s -w "\n%{http_code}" -X "$method" \
            -H "Content-Type: application/json" \
            -d "$data" \
            "${BASE_URL}${path}" 2>&1)
    else
        response=$(curl -s -w "\n%{http_code}" -X "$method" \
            "${BASE_URL}${path}" 2>&1)
    fi
    
    status=$(echo "$response" | tail -1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$status" = "$expected_status" ]; then
        echo -e "${GREEN}✓ PASS${NC} (HTTP $status)"
        PASS=$((PASS + 1))
    else
        echo -e "${RED}✗ FAIL${NC} (HTTP $status, expected $expected_status)"
        echo "   Response: $body" | head -c 200
        echo ""
        FAIL=$((FAIL + 1))
    fi
}

echo "--- 1. 基础端点 ---"
test_endpoint "GET" "/" "首页" 200
test_endpoint "GET" "/api" "API 根" 200

echo ""
echo "--- 2. 只读端点 ---"
test_endpoint "GET" "/api/agents" "列出 agents" 200
test_endpoint "GET" "/api/queues" "列出 queues" 200
test_endpoint "GET" "/api/pools" "列出 pools" 200
test_endpoint "GET" "/api/dashboard" "Dashboard 页面" 200
test_endpoint "GET" "/api/skill" "Skill 下载" 200
test_endpoint "GET" "/api/mcp" "MCP 配置" 200

echo ""
echo "--- 3. Agent 操作 ---"
test_endpoint "POST" "/api/agent/register" "注册 producer agent" 200 \
    '{"agentId":"test-agent-001","name":"Test Agent","role":"producer","queues":["test-queue"]}'
test_endpoint "POST" "/api/agent/register" "注册 consumer agent" 200 \
    '{"agentId":"test-agent-002","name":"Test Consumer","role":"consumer","queues":[]}'
test_endpoint "POST" "/api/agent/produce" "生产消息" 200 \
    '{"agentId":"test-agent-001","queue":"test-queue","data":"test data"}'
test_endpoint "GET" "/api/peek?queue=test-queue" "窥视队列" 200
test_endpoint "POST" "/api/agent/consume" "消费消息" 200 \
    '{"agentId":"test-agent-002","queue":"test-queue"}'
test_endpoint "POST" "/api/agent/produce" "生产管道源数据" 200 \
    '{"agentId":"test-agent-001","queue":"test-queue","data":"pipe source data"}'
test_endpoint "POST" "/api/agent/pipe" "管道传递" 200 \
    '{"agentId":"test-agent-001","sourceQueue":"test-queue","targetQueue":"test-queue-2","data":"piped data"}'

echo ""
echo "--- 4. Pool 操作 ---"
test_endpoint "POST" "/api/pool/create" "创建 pool" 200 \
    '{"name":"test-pool-001","description":"Test Pool"}'
test_endpoint "POST" "/api/pool/join" "加入 pool" 200 \
    '{"pool":"test-pool-001","agentId":"test-agent-001"}'
test_endpoint "POST" "/api/pool/speak" "Pool 发言" 200 \
    '{"pool":"test-pool-001","agentId":"test-agent-001","content":"Hello Pool"}'
test_endpoint "GET" "/api/pool/messages?pool=test-pool-001" "Pool 消息列表" 200
test_endpoint "GET" "/api/pool/members?pool=test-pool-001" "Pool 成员列表" 200

echo ""
echo "=========================================="
echo "测试结果: ${GREEN}$PASS 通过${NC}, ${RED}$FAIL 失败${NC}"
echo "=========================================="

if [ $FAIL -gt 0 ]; then
    exit 1
fi
