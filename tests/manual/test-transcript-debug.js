// Detailed debug test for youtube-transcript
const { YoutubeTranscript } = require('youtube-transcript');

async function debugTest() {
  const videoId = 'dQw4w9WgXcQ';
  console.log('Testing youtube-transcript library with detailed debugging\n');
  console.log(`Video ID: ${videoId}`);
  console.log(`Library version: 1.2.1\n`);

  try {
    console.log('Attempting to fetch transcript...');
    const startTime = Date.now();

    const result = await YoutubeTranscript.fetchTranscript(videoId);

    const endTime = Date.now();
    console.log(`\nRequest completed in ${endTime - startTime}ms`);
    console.log(`\nResult type: ${typeof result}`);
    console.log(`Result is array: ${Array.isArray(result)}`);
    console.log(`Result length: ${result ? result.length : 'null'}`);
    console.log(`\nFull result:`);
    console.log(JSON.stringify(result, null, 2));

    if (result && Array.isArray(result) && result.length > 0) {
      console.log(`\n✅ Success! Got ${result.length} segments`);
      console.log(`First segment:`, result[0]);
    } else {
      console.log('\n⚠️  Empty result - no captions available');
    }
  } catch (error) {
    console.log('\n❌ Error occurred:');
    console.log(`Error type: ${error.constructor.name}`);
    console.log(`Error message: ${error.message}`);
    console.log(`Error stack:\n${error.stack}`);
  }
}

debugTest().then(() => {
  console.log('\n\nDebug test completed');
  process.exit(0);
}).catch(error => {
  console.error('\nUnexpected error:', error);
  process.exit(1);
});
