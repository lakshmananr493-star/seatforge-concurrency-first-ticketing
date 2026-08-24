export function jsonError(message:string,status=400){return Response.json({error:message},{status})}
export function getIdempotencyKey(req:Request){return req.headers.get('Idempotency-Key')||crypto.randomUUID()}
