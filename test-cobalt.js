async function testCobalt() {
  try {
    const response = await fetch('https://api.cobalt.tools/', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        videoQuality: '1080',
        audioFormat: 'mp3',
        downloadMode: 'auto'
      })
    });
    
    console.log('STATUS:', response.status);
    const data = await response.json();
    console.log('DATA:', JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('ERROR:', err);
  }
}

testCobalt();
