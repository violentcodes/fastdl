async function testInstagramCobalt() {
  const instances = [
    'https://cobaltapi.kittycat.boo/',
    'https://dog.kittycat.boo/'
  ];
  
  // A public Instagram Reel URL
  const reelUrl = 'https://www.instagram.com/reel/C7P3sI_IEtA/';
  
  for (const url of instances) {
    console.log('Testing IG on:', url);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url: reelUrl,
          videoQuality: '720',
          audioFormat: 'mp3',
          downloadMode: 'auto'
        })
      });
      
      console.log(`STATUS [${url}]:`, response.status);
      const data = await response.json();
      console.log(`DATA [${url}]:`, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error(`ERROR [${url}]:`, err.message);
    }
    console.log('-----------------------------------');
  }
}

testInstagramCobalt();
