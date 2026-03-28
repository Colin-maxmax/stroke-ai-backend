// api/chat.js
import fetch from 'node-fetch'; // Vercel 的 Node.js 环境默认包含 fetch，但为了兼容性可以显式安装
// 也可以直接使用原生 fetch，Node 18+ 支持

export default async function handler(req, res) {
    // 设置 CORS 头（允许跨域）
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // 处理预检请求
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { message, assessment } = req.body;
    if (!message) {
        return res.status(400).json({ error: '消息不能为空' });
    }

    // 设置 SSE 响应头（Vercel 支持流式响应）
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    });

    // 构建系统提示词
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
        const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: message }
                ],
                max_tokens: 1000,
                stream: true,
                temperature: 0.7,
            }),
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const dataStr = line.slice(6);
                    if (dataStr === '[DONE]') continue;
                    try {
                        const data = JSON.parse(dataStr);
                        const content = data.choices[0]?.delta?.content;
                        if (content) {
                            res.write(`data: ${JSON.stringify({ content })}\n\n`);
                        }
                    } catch (e) {
                        // 忽略解析错误
                    }
                }
            }
        }
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
    } catch (error) {
        console.error('DeepSeek API 错误:', error.message);
        res.write(`data: ${JSON.stringify({ error: '服务暂时不可用' })}\n\n`);
        res.end();
    }
}