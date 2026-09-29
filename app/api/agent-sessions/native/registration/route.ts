import { NextResponse } from "next/server";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import { registrationLegalDocuments } from "@/apps/web/legal/service";
import { apiError } from "@/apps/web/http/api-error";
import { getRuntimeEnvironment } from "@/platform/host/env";

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-bke-account-session-version":
        AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
    },
  });
}

export async function GET(request: Request) {
  try {
    const runtime = getRuntimeEnvironment();
    if (!runtime.AGENT_ACCOUNT_SESSION_ENABLED) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    rejectBrowserOriginForAgent(request);
    requireAgentAccountSessionProtocol(request);

    const documents = await registrationLegalDocuments();
    if (
      documents.length !== 2
      || documents.some(
        (document) =>
          !document.currentPublishedVersionId
          || !document.currentPublishedVersion
          || document.currentPublishedVersion.status !== "PUBLISHED",
      )
    ) {
      return response({ error: "REGISTRATION_UNAVAILABLE" }, 503);
    }

    return response({
      status: "ready",
      legal_documents: documents.map((document) => ({
        document_type: document.documentType,
        title: document.title,
        slug: document.slug,
        version_id: document.currentPublishedVersionId,
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}
