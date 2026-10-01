import { CognitoJwtVerifier } from "aws-jwt-verify";

// Function URLs have no Cognito authorizer, so the Lambda checks the token itself.
// The access token is the one meant for API calls: it carries the user's stable
// `sub` and the app client id, and Cognito signs it with the pool's JWKS.
export const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.USER_POOL_ID!,
  clientId: process.env.USER_POOL_CLIENT_ID!,
  tokenUse: "access",
});

/** Returns the Cognito user id (`sub`) for a valid Bearer token, or null. */
export async function userIdFrom(authorization: string | undefined): Promise<string | null> {
  const match = /^Bearer (\S+)$/i.exec(authorization ?? "");
  if (!match) return null;
  try {
    const claims = await verifier.verify(match[1]);
    return claims.sub;
  } catch (err) {
    console.warn(`Token rejected: ${(err as Error).constructor.name}`);
    return null;
  }
}
