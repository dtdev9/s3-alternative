const fs = require('fs')
const path = require('path')
const { URL } = require('url')

const Minio = require('./minio-js')

const MINIO_URL = process.env.MINIO_URL || 'http://localhost:9000'
const ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'minioadmin'
const SECRET_KEY = process.env.MINIO_SECRET_KEY || 'minioadmin'
const BUCKET_NAME = process.env.MINIO_BUCKET || 'uploads'

function createClient() {
  const parsed = new URL(MINIO_URL)

  return new Minio.Client({
    endPoint: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80,
    useSSL: parsed.protocol === 'https:',
    accessKey: ACCESS_KEY,
    secretKey: SECRET_KEY,
  })
}

async function ensureBucketExists() {
  const client = createClient()
  const exists = await client.bucketExists(BUCKET_NAME)

  if (!exists) {
    await client.makeBucket(BUCKET_NAME, 'us-east-1')
  }
}

async function uploadFile(filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`File not found: ${filePath}`)
  }

  await ensureBucketExists()

  const client = createClient()
  const objectName = path.basename(filePath)
  const fileSize = fs.statSync(filePath).size
  const contentType = guessContentType(filePath)

  const etag = await client.fPutObject(
    BUCKET_NAME,
    objectName,
    filePath,
    { 'Content-Type': contentType },
  )

  return {
    data: {
      bucket: BUCKET_NAME,
      objectName,
      size: fileSize,
      etag,
      url: await getUrl(objectName),
    },
  }
}

async function getUrl(objectName) {
  const client = createClient()
  return client.presignedGetObject(BUCKET_NAME, objectName, 60 * 60)
}

async function deleteFile(objectName) {
  const client = createClient()
  await client.removeObject(BUCKET_NAME, objectName)
}

async function listFiles(prefix = '') {
  const client = createClient()
  const stream = client.listObjectsV2(BUCKET_NAME, prefix, true)

  return new Promise((resolve, reject) => {
    const files = []
    const pending = []
    let settled = false

    stream.on('data', (obj) => {
      pending.push(
        getUrl(obj.name).then((url) => {
          files.push({
            objectName: obj.name,
            size: obj.size || 0,
            etag: obj.etag || '',
            url,
          })
        })
      )
    })

    stream.on('error', (error) => {
      if (!settled) {
        settled = true
        reject(error)
      }
    })

    stream.on('end', async () => {
      try {
        await Promise.all(pending)
        if (!settled) {
          settled = true
          resolve(files)
        }
      } catch (error) {
        if (!settled) {
          settled = true
          reject(error)
        }
      }
    })
  })
}

function guessContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase()

  const types = {
    '.txt': 'text/plain',
    '.json': 'application/json',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.cjs': 'application/javascript',
    '.html': 'text/html',
    '.css': 'text/css',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
    '.mp4': 'video/mp4',
  }

  return types[ext] || 'application/octet-stream'
}

async function main() {
  if (process.argv.length < 3) {
    console.log('Usage: node javascript_sample.js <file_path>')
    console.log('')
    console.log('Examples:')
    console.log('  node javascript_sample.js /path/to/video.mp4')
    console.log('  node javascript_sample.js /path/to/large-file.zip')
    process.exit(1)
  }

  const filePath = process.argv[2]
  const objectName = path.basename(filePath)

  console.log(`[upload] ${filePath}  ->  ${MINIO_URL}/${BUCKET_NAME}/${objectName}`)

  try {
    const result = await uploadFile(filePath)
    const data = result.data || {}

    console.log('')
    console.log(`  bucket : ${data.bucket}`)
    console.log(`  object : ${data.objectName}`)
    console.log(`  size   : ${(data.size / 1024 / 1024).toFixed(1)} MB`)
    console.log(`  etag   : ${data.etag}`)
    console.log(`  url    : ${data.url}`)
  } catch (error) {
    console.error(`Error: ${error.message}`)
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}

module.exports = {
  createClient,
  ensureBucketExists,
  uploadFile,
  getUrl,
  deleteFile,
  listFiles,
}
