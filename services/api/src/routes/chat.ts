import { runDataAgent } from '../../../agent-runtime/src/data-agent';

export async function chatHandler(req: any, res: any) {
  try {
    const message = req.body?.message;

    if (!message) {
      return res.status(400).json({
        error: 'message is required',
      });
    }

    const result = await runDataAgent(message);

    return res.json({
      answer: result.answer,
      sql: result.sql,
      data: result.data,
      trace: result.trace,
    });
  } catch (error: any) {
    return res.status(500).json({
      error: error.message,
    });
  }
}
