export default async function handler(req, res) {
    // CORS setup
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const upstreamResponse = await fetch('https://toolkit.rork.com/text/llm/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Origin': 'http://localhost:3000', // Mimic local origin
                'Referer': 'http://localhost:3000/',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            body: JSON.stringify(req.body)
        });

        if (!upstreamResponse.ok) {
            throw new Error(`Upstream API failed: ${upstreamResponse.status}`);
        }

        const data = await upstreamResponse.json();
        return res.status(200).json(data);

    } catch (error) {
        console.error('LLM Proxy Error:', error);
        return res.status(500).json({
            error: 'Failed to generate response',
            details: error.message
        });
    }
}
