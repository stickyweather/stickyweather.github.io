const fs = require('fs');
const https = require('https');
const path = require('path');

// Parse Jekyll frontmatter
function parsePost(filepath) {
  const content = fs.readFileSync(filepath, 'utf8');
  const match = content.match(/^---\n([\s\S]+?)\n---\n([\s\S]*)$/);
  
  if (!match) return null;
  
  const frontmatter = {};
  match[1].split('\n').forEach(line => {
    const [key, ...valueParts] = line.split(':');
    if (key) frontmatter[key.trim()] = valueParts.join(':').trim().replace(/^["']|["']$/g, '');
  });
  
  return {
    frontmatter,
    content: match[2].trim(),
    filepath
  };
}

// Post to Mastodon
async function postToMastodon(text, postUrl) {
  const instance = process.env.MASTODON_INSTANCE;
  const token = process.env.MASTODON_ACCESS_TOKEN;
  
  const status = `${text}\n\n${postUrl}`;
  
  const data = JSON.stringify({ status });
  
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: instance,
      path: '/api/v1/statuses',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const response = JSON.parse(body);
        resolve(response.url);
      });
    });
    
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Post to Bluesky
async function postToBluesky(text, postUrl) {
  const handle = process.env.BLUESKY_HANDLE;
  const password = process.env.BLUESKY_APP_PASSWORD;
  
  // First, authenticate
  const authData = JSON.stringify({
    identifier: handle,
    password: password
  });
  
  const session = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'bsky.social',
      path: '/xrpc/com.atproto.server.createSession',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': authData.length
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    
    req.on('error', reject);
    req.write(authData);
    req.end();
  });
  
  // Create the post
  const postText = `${text}\n\n${postUrl}`;
  const postData = JSON.stringify({
    repo: session.did,
    collection: 'app.bsky.feed.post',
    record: {
      text: postText,
      createdAt: new Date().toISOString()
    }
  });
  
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'bsky.social',
      path: '/xrpc/com.atproto.repo.createRecord',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.accessJwt}`,
        'Content-Type': 'application/json',
        'Content-Length': postData.length
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const response = JSON.parse(body);
        const bskyUrl = `https://bsky.app/profile/${handle}/post/${response.uri.split('/').pop()}`;
        resolve(bskyUrl);
      });
    });
    
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Main function
async function main() {
  const files = process.argv[2].split('\n').filter(f => f);
  
  for (const file of files) {
    console.log(`Processing ${file}...`);
    
    // Skip if not in social directory
    if (!file.includes('_posts/social/')) {
      console.log(`Skipping ${file} (not a social post)`);
      continue;
    }
    
    const post = parsePost(file);
    if (!post) {
      console.log(`Could not parse ${file}`);
      continue;
    }
    
    // Verify it has collection: social in frontmatter
    if (post.frontmatter.collection !== 'social') {
      console.log(`Skipping ${file} (collection is not 'social')`);
      continue;
    }
    
    // Build the canonical URL
    const slug = file.match(/\d{4}-\d{2}-\d{2}-(.*?)\.md$/)[1];
    const date = file.match(/(\d{4})-(\d{2})-(\d{2})/);
    const postUrl = `${process.env.SITE_URL}/social/${date[1]}/${date[2]}/${date[3]}/${slug}/`;
    
    try {
      // Post to Mastodon and Bluesky
      const mastodonUrl = await postToMastodon(post.content, postUrl);
      console.log(`✓ Posted to Mastodon: ${mastodonUrl}`);
      
      const blueskyUrl = await postToBluesky(post.content, postUrl);
      console.log(`✓ Posted to Bluesky: ${blueskyUrl}`);
      
    } catch (error) {
      console.error(`✗ Error syndicating ${file}:`, error.message);
    }
  }
}

main();