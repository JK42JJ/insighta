// Quick test script for youtube-transcript library
const { YoutubeTranscript } = require('youtube-transcript');

async function testTranscript() {
  const videoId = 'dQw4w9WgXcQ';
  console.log(`Testing transcript for video: ${videoId}`);

  try {
    console.log('\n1. Testing without language specification:');
    const transcript1 = await YoutubeTranscript.fetchTranscript(videoId);
    console.log(`   Success! Got ${transcript1.length} segments`);
    console.log(`   First segment:`, transcript1[0]);
  } catch (error) {
    console.log(`   Error:`, error.message);
  }

  try {
    console.log('\n2. Testing with lang=en:');
    const transcript2 = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
    console.log(`   Success! Got ${transcript2.length} segments`);
    console.log(`   First segment:`, transcript2[0]);
  } catch (error) {
    console.log(`   Error:`, error.message);
  }

  try {
    console.log('\n3. Testing with lang=ja:');
    const transcript3 = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'ja' });
    console.log(`   Success! Got ${transcript3.length} segments`);
    console.log(`   First segment:`, transcript3[0]);
  } catch (error) {
    console.log(`   Error:`, error.message);
  }
}

testTranscript().then(() => {
  console.log('\nTest completed');
  process.exit(0);
}).catch(error => {
  console.error('\nTest failed:', error);
  process.exit(1);
});
