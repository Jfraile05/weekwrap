import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME!;

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
