import type { NextApiRequest, NextApiResponse } from 'next';
import { VideoConfig } from '@models/config';
import { generateVideo } from '@services/shotstackService';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === 'POST') {
    try {
      const videoConfig: VideoConfig = req.body;
      const id = await generateVideo(videoConfig);
      res.status(201).json({ id });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
      console.log('POST /create - Error:', (error as Error).message);
    }
  } else {
    res.setHeader('Allow', ['POST']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
