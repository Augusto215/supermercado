import { NextResponse } from "next/server";
import { generateToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth-token";

export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try {
    body = (await request.json()) as { email?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }

  const { email, password } = body;

  const expectedEmail    = (process.env.RHID_API_EMAIL    ?? "").trim();
  const expectedPassword = (process.env.RHID_API_PASSWORD ?? "").trim();

  if (
    !email ||
    !password ||
    email.trim() !== expectedEmail ||
    password !== expectedPassword
  ) {
    return NextResponse.json({ error: "E-mail ou senha incorretos." }, { status: 401 });
  }

  const token = await generateToken(expectedEmail, expectedPassword);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
    secure: process.env.HTTPS === "true",
  });

  return response;
}
