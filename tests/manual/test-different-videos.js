// Test different videos to find one with working captions
const { YoutubeTranscript } = require('youtube-transcript');

const testVideos = [
  { id: 'dQw4w9WgXcQ', name: 'Rick Astley - Never Gonna Give You Up' },
  { id: 'jNQXAC9IVRw', name: 'Me at the zoo (first YouTube video)' },
  { id: '_OBlgSz8sSM', name: 'Charlie bit my finger' },
  { id: 'kJQP7kiw5Fk', name: 'Luis Fonsi - Despacito' },
];

async function testVideo(video) {
  console.log(`\nTesting: ${video.name} (${video.id})`);

  try {
    const transcript = await YoutubeTranscript.fetchTranscript(video.id);
    if (transcript && transcript.length > 0) {
      console.log(`  ✅ SUCCESS! Got ${transcript.length} segments`);
      console.log(`  First: "${transcript[0].text}"`);
      return true;
    } else {
      console.log(`  ⚠️  Got 0 segments`);
      return false;
    }
  } catch (error) {
    console.log(`  ❌ Error: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('Testing multiple videos to find one with working captions...\n');

  for (const video of testVideos) {
    const success = await testVideo(video);
    if (success) {
      console.log(`\n✨ Found working video: ${video.id}`);
      break;
    }
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\nTest completed');
}

main().then(() => process.exit(0)).catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
