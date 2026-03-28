import dotenv from 'dotenv';
dotenv.config(); // 本地开发时加载 .env 文件，云平台会忽略此步骤

import express from 'express';
import OpenAI from 'openai';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// 检查 API Key 是否存在（云平台通过环境变量注入）
if (!process.env.DEEPSEEK_API_KEY) {
    console.error('错误：未找到 DEEPSEEK_API_KEY，请检查环境变量设置');
    process.exit(1);
}

const client = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: 'https://api.deepseek.com/v1',
});

// 健康检查接口（可选，用于监控）
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/chat', async (req, res) => {
    const { message, assessment } = req.body;
    if (!message) return res.status(400).json({ error: '消息不能为空' });

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
    });

    let systemPrompt = `你是一位专业的脑卒中健康顾问，服务于粤北地区（韶关、清远、河源等）。
请用亲切、通俗的语言回答，像关心长辈一样。
回答要简洁明了，避免长段落。
涉及医学建议时，提醒用户咨询专业医生。
对于紧急情况（如突然中风症状），立即建议拨打120。`;

    if (assessment) {
        systemPrompt += `\n\n当前用户信息：
- 年龄：${assessment.age || '未知'}岁
- 风险等级：${assessment.riskLevel || '未知'}
- 主要风险因素：${(assessment.riskFactors || []).join('、') || '无'}
- 是否有高血压：${assessment.hypertension ? '是' : '否'}`;
    }

    try {
        const stream = await client.chat.completions.create({
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: message }
            ],
            max_tokens: 1000,
            stream: true,
            temperature: 0.7,
        });

        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
                res.write(`data: ${JSON.stringify({ content })}\n\n`);
                if (res.flush) res.flush();
            }
        }
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
    } catch (error) {
        console.error('DeepSeek API 错误:', error.message);
        res.write(`data: ${JSON.stringify({ error: '服务暂时不可用' })}\n\n`);
        res.end();
    }
});

app.listen(PORT, () => {
    console.log(`AI 后端服务运行在 http://localhost:${PORT}`);
});