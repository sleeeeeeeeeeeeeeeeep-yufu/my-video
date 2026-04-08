import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { videoSrc } = await request.json();

    if (!videoSrc) {
      return NextResponse.json({ error: 'videoSrc is required' }, { status: 400 });
    }

    const episodePath = path.join(process.cwd(), 'src', 'episode.json');
    const episodeContent = await fs.readFile(episodePath, 'utf8');
    const episode = JSON.parse(episodeContent);

    // Update the videoSrc
    episode.videoSrc = videoSrc;

    // Write back to the file
    await fs.writeFile(episodePath, JSON.stringify(episode, null, 2), 'utf8');

    return NextResponse.json({ success: true, episode });
  } catch (error) {
    console.error('Failed to update episode.json:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
