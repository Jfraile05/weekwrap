import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME!;
const PROFILES = process.env.PROFILES_TABLE_NAME!;

export type Profile = {
  userId: string;
  githubUsername: string;
  createdAt: string;
};

export type Wrap = {
  username: string;
  createdAt: string;
  markdown: string;
  eventCount: number;
  repos: string[];
  trigger: "web" | "schedule";
};

export async function save(wrap: Wrap): Promise<void> {
  // 90 day TTL keeps the table small and inside the free tier forever.
  const expiresAt = Math.floor(Date.now() / 1000) + 90 * 86400;
  await doc.send(new PutCommand({ TableName: TABLE, Item: { ...wrap, expiresAt } }));
}

export async function history(username: string, limit = 5): Promise<Wrap[]> {
  const out = await doc.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "username = :u",
      ExpressionAttributeValues: { ":u": username.toLowerCase() },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  return (out.Items ?? []) as Wrap[];
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const out = await doc.send(new GetCommand({ TableName: PROFILES, Key: { userId } }));
  return (out.Item as Profile | undefined) ?? null;
}

export async function putProfile(userId: string, githubUsername: string): Promise<Profile> {
  const out = await doc.send(
    new UpdateCommand({
      TableName: PROFILES,
      Key: { userId },
      UpdateExpression: "SET githubUsername = :g, createdAt = if_not_exists(createdAt, :now)",
      ExpressionAttributeValues: { ":g": githubUsername, ":now": new Date().toISOString() },
      ReturnValues: "ALL_NEW",
    }),
  );
  return out.Attributes as Profile;
}
