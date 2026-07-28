import 'dotenv/config';

// The S3Provider uses fromNodeProviderChain() which reads the standard AWS env vars.
// Map the project-specific S3_* names so integration tests can use dev credentials.
process.env.AWS_ACCESS_KEY_ID ??= process.env.S3_ACCESS_KEY_ID;
process.env.AWS_SECRET_ACCESS_KEY ??= process.env.S3_SECRET_ACCESS_KEY;
