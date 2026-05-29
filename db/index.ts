import { createClient } from "@supabase/supabase-js";
import * as schema from "./schema";
import crypto from "crypto";

const isValidUrl = (url: string | undefined): boolean => {
  if (!url) return false;
  if (url === "your_supabase_url" || url.includes("mock-supabase-url")) return false;
  try {
    new URL(url);
    return true;
  } catch (_) {
    return false;
  }
};

const isDbConfigured = isValidUrl(process.env.SUPABASE_URL) &&
                       !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
                       process.env.SUPABASE_SERVICE_ROLE_KEY !== "your_service_role_key" &&
                       process.env.SUPABASE_SERVICE_ROLE_KEY !== "mock-service-role-key";

const supabaseClient = isDbConfigured
  ? createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false }
    })
  : null;

const camelToSnake: Record<string, string> = {
  id: "id",
  status: "status",
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

const snakeToCamel: Record<string, string> = Object.fromEntries(
  Object.entries(camelToSnake).map(([k, v]) => [v, k])
);

function toSnakeCase(data: any): any {
  if (!data) return data;
  const result: any = {};
  for (const [k, v] of Object.entries(data)) {
    const snakeKey = camelToSnake[k] || k;
    result[snakeKey] = v;
  }
  return result;
}

function toCamelCase(data: any): any {
  if (!data) return data;
  const result: any = {};
  for (const [k, v] of Object.entries(data)) {
    const camelKey = snakeToCamel[k] || k;
    result[camelKey] = v;
  }
  return result;
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

export const db = {
  select: () => {
    return {
      from: (table: any) => {
        return {
          where: async (condition: any) => {
            const recordId = getParamFromSql(condition);
            if (!recordId) return [];

            if (supabaseClient) {
              const { data, error } = await supabaseClient
                .from("security_threats_pipeline")
                .select("*")
                .eq("id", recordId);

              if (error) {
                console.error("[DB] Supabase select error:", error);
                throw error;
              }
              return data ? data.map(toCamelCase) : [];
            } else {
              const store = getStore();
              const record = store.get(recordId);
              return record ? [toCamelCase(record)] : [];
            }
          },
        };
      },
    };
  },
  insert: (table: any) => {
    return {
      values: (data: any) => {
        return {
          returning: async (fields: any) => {
            const id = data.id || crypto.randomUUID();
            const recordData = {
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
            };

            if (supabaseClient) {
              const { data: record, error } = await supabaseClient
                .from("security_threats_pipeline")
                .insert(toSnakeCase(recordData))
                .select("*")
                .single();

              if (error) {
                console.error("[DB] Supabase insert error:", error);
                throw error;
              }
              return [toCamelCase(record)];
            } else {
              const store = getStore();
              const mappedRecord = toSnakeCase(recordData);
              store.set(id, mappedRecord);
              return [toCamelCase(mappedRecord)];
            }
          },
        };
      },
    };
  },
  update: (table: any) => {
    return {
      set: (data: any) => {
        return {
          where: async (condition: any) => {
            const recordId = getParamFromSql(condition);
            if (!recordId) return;

            const updateData = toSnakeCase({
              ...data,
              updatedAt: new Date(),
            });

            if (supabaseClient) {
              const { error } = await supabaseClient
                .from("security_threats_pipeline")
                .update(updateData)
                .eq("id", recordId);

              if (error) {
                console.error("[DB] Supabase update error:", error);
                throw error;
              }
            } else {
              const store = getStore();
              if (store.has(recordId)) {
                const current = store.get(recordId);
                const updated = {
                  ...current,
                  ...updateData,
                };
                store.set(recordId, updated);
              }
            }
          },
        };
      },
    };
  },
} as any;
