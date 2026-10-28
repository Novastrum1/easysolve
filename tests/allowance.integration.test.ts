import "dotenv/config";
import { afterAll,beforeAll,expect,it,vi } from "vitest";
import { ai,AllowanceError } from "../lib/ai";
import { db } from "../lib/db";
import { monthStart } from "../lib/policy";
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => ({
  default: class {
    responses = { create };
  },
}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
function events(response:unknown){return (async function*(){yield {type:'response.completed',response};})();}
let userId = "";
beforeAll(async () => {
  userId = (
    await db.user.create({
      data: {
        email: `usage-${crypto.randomUUID()}@example.test`,
        name: "Usage fixture",
        password: "test-only",
        settings: { monthlyTokens: 10000 },
      },
    })
  ).id;
  process.env.DEEPSEEK_API_KEY = "test-only-provider-mocked";
  create.mockImplementation(async()=>events({
    status:'completed',model:'deepseek-flash',output:[{type:'message',content:[{type:'output_text',text:'verified provider output'}]}],
    usage: {
      input_tokens: 20,
      input_tokens_details: { cached_tokens: 5 },
      output_tokens: 10,
      total_tokens: 30,
    },
  }));
});
afterAll(async () => {
  await db.user.delete({ where: { id: userId } });
  await db.$disconnect();
  delete process.env.DEEPSEEK_API_KEY;
});
it("records actual provider token breakdown and ignores last month at reset", async () => {
  const old = new Date(monthStart().getTime() - 1000);
  await db.usage.create({
    data: {
      userId,
      purpose: "old",
      model: "fixture",
      input: 1000000,
      output: 0,
      total: 1000000,
      createdAt: old,
    },
  });
  await expect(ai(userId, "test", "hello", "Be concise")).resolves.toBe(
    "verified provider output",
  );
  const record = await db.usage.findFirstOrThrow({
    where: { userId, purpose: "test" },
  });
  expect(record).toMatchObject({ input: 20, cached: 5, output: 10, total: 30 });
});
it("refuses an exhausted allowance before contacting DeepSeek", async () => {
  create.mockClear();
  await db.user.update({
    where: { id: userId },
    data: { settings: { monthlyTokens: 1000 } },
  });
  await expect(
    ai(userId, "blocked", "hello", "instruction"),
  ).rejects.toBeInstanceOf(AllowanceError);
  expect(create).not.toHaveBeenCalled();
});
it("caps user allowances by server entitlement", async () => {
  await db.user.update({
    where: { id: userId },
    data: { settings: { monthlyTokens: 10000000 } },
  });
  const before = process.env.PLAN_MAX_TOKENS;
  process.env.PLAN_MAX_TOKENS = "100";
  await expect(
    ai(userId, "blocked", "hello", "instruction"),
  ).rejects.toBeInstanceOf(AllowanceError);
  if (before === undefined) delete process.env.PLAN_MAX_TOKENS;
  else process.env.PLAN_MAX_TOKENS = before;
});

it("uses actual Responses function calls for chat actions", async () => {
  await db.user.update({
    where: { id: userId },
    data: { settings: { monthlyTokens: 1000000 } },
  });
  create.mockResolvedValueOnce(events({
    status:'completed',model:'deepseek-flash',
    output: [{ type: "function_call", name: "check_jobs", arguments: "{}" }],
    usage: {
      input_tokens: 10,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 3,
      total_tokens: 13,
    },
  }));
  const { chatTools } = await import("../lib/chat-tools");
  const result = JSON.parse(
    await ai(
      userId,
      "chat",
      "Check jobs",
      "Only use provided tools",
      undefined,
      chatTools,
    ),
  );
  expect(result.action.type).toBe("check_jobs");
  expect(create).toHaveBeenLastCalledWith(
    expect.objectContaining({
      tools:chatTools.map(t=>({...t,strict:null})),
      stream:true,
      model:'deepseek-flash',
    }),expect.objectContaining({signal:expect.any(AbortSignal)}),
  );
});

it('enforces custom allowance windows independently of calendar plan ceilings',async()=>{const {allowanceWindow}=await import('../lib/policy');await db.usage.deleteMany({where:{userId}});const config={resetDay:28,resetHour:0};const window=allowanceWindow(config);await db.user.update({where:{id:userId},data:{settings:{...config,monthlyTokens:1000}}});await db.usage.create({data:{userId,purpose:'previous-cycle',model:'fixture',input:9000,output:0,total:9000,createdAt:new Date(window.start.getTime()-1000)}});const previous=process.env.AI_MAX_OUTPUT_TOKENS;process.env.AI_MAX_OUTPUT_TOKENS='100';try{await expect(ai(userId,'new-cycle','hello','concise')).resolves.toBe('verified provider output');await db.usage.create({data:{userId,purpose:'current-cycle',model:'fixture',input:1000,output:0,total:1000}});let error:unknown;try{await ai(userId,'blocked','hello','concise')}catch(e){error=e;}expect(error).toBeInstanceOf(AllowanceError);expect((error as AllowanceError).reset).toEqual(window.reset);}finally{if(previous===undefined)delete process.env.AI_MAX_OUTPUT_TOKENS;else process.env.AI_MAX_OUTPUT_TOKENS=previous;}});
