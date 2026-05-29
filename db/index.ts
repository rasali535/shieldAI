import { drizzle } from "drizzle-orm/netlify-db";
import * as schema from "./schema";
import crypto from "crypto";

const keysToMap: Record<string, string> = {
  threatSource: "threat_source",
  threatPayload: "threat_payload",
  riskScore: "risk_score",
  riskAnalysis: "risk_analysis",
  brightdataJobId: "brightdata_job_id",
  enrichedTargets: "enriched_targets",
  outreachDrafts: "outreach_drafts",
  errorMessage: "error_message",
  createdAt: "created_at",
  updatedAt: "updated_at",
};

function mapRecordKeys(record: any) {
  if (!record) return record;
  const newRecord = { ...record };
  for (const [camel, snake] of Object.entries(keysToMap)) {
    if (camel in newRecord && newRecord[camel] !== undefined) {
      newRecord[snake] = newRecord[camel];
    } else if (snake in newRecord && newRecord[snake] !== undefined) {
      newRecord[camel] = newRecord[snake];
    }
  }
  return newRecord;
}

const localMockStore = new Map<string, any>();

const getStore = (): Map<string, any> => {
  if (typeof global !== "undefined" && (global as any).mockDatabase) {
    return (global as any).mockDatabase;
  }
  return localMockStore;
};

function getParamFromSql(sqlExpr: any): string | null {
  if (sqlExpr && Array.isArray(sqlExpr.queryChunks)) {
    for (const chunk of sqlExpr.queryChunks) {
      if (chunk && typeof chunk === "object" && "value" in chunk) {
        if (chunk.constructor.name === "Param" || ("brand" in chunk && "encoder" in chunk)) {
          return chunk.value;
        }
      }
    }
  }
  return null;
}

const mockDb = {
  select: () => {
    return {
      from: (table: any) => {
        return {
          where: (condition: any) => {
            const recordId = getParamFromSql(condition);
            const store = getStore();
            const record = recordId ? store.get(recordId) : null;
            return record ? [mapRecordKeys(record)] : [];
          },
        };
      },
    };
  },
  insert: (table: any) => {
    return {
      values: (data: any) => {
        return {
          returning: (fields: any) => {
            const id = data.id || crypto.randomUUID();
            const record = mapRecordKeys({
              id,
              status: data.status || "RAW_DETECTED",
              threatSource: data.threatSource || "",
              threatPayload: data.threatPayload || {},
              riskScore: data.riskScore || null,
              riskAnalysis: data.riskAnalysis || null,
              brightdataJobId: data.brightdataJobId || null,
              enrichedTargets: data.enrichedTargets || null,
              outreachDrafts: data.outreachDrafts || null,
              errorMessage: data.errorMessage || null,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
            const store = getStore();
            store.set(id, record);
            return [record];
          },
        };
      },
    };
  },
  update: (table: any) => {
    return {
      set: (data: any) => {
        return {
          where: (condition: any) => {
            const recordId = getParamFromSql(condition);
            const store = getStore();
            if (recordId && store.has(recordId)) {
              const current = store.get(recordId);
              const updated = mapRecordKeys({
                ...current,
                ...data,
                updatedAt: new Date(),
              });
              store.set(recordId, updated);
            }
            return Promise.resolve();
          },
        };
      },
    };
  },
};

export const db = process.env.NETLIFY_DB_URL ? drizzle({ schema }) : (mockDb as any);
