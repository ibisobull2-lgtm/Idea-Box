require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const app = express();
const port = Number(process.env.PORT || 3000);
const secret = process.env.JWT_SECRET;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!secret || secret.length < 32) throw new Error("JWT_SECRET must be at least 32 characters");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
  max: 10, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000
});
app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin(origin, cb) {
    const allowed = (process.env.FRONTEND_ORIGIN || "").split(",").map(x => x.trim()).filter(Boolean);
    if (!origin || allowed.includes(origin)) return cb(null, true);
    return cb(new Error("Origin not allowed by CORS"));
  },
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json({ limit: "100kb" }));
app.use("/api/auth", rateLimit({ windowMs: 900000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false }));
app.use("/api", rateLimit({ windowMs: 900000, limit: 180, standardHeaders: "draft-7", legacyHeaders: false }));

async function initDb() {
  await pool.query("CREATE TABLE IF NOT EXISTS users (id BIGSERIAL PRIMARY KEY,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,display_name TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS transactions (id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL CHECK(kind IN ('income','expense')),amount NUMERIC(14,2) NOT NULL CHECK(amount>0),category TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE INDEX IF NOT EXISTS transactions_user_date_idx ON transactions(user_id,transaction_date DESC)");
  await pool.query("CREATE TABLE IF NOT EXISTS business_ideas (id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,title TEXT NOT NULL,industry TEXT NOT NULL DEFAULT '',customer TEXT NOT NULL DEFAULT '',problem TEXT NOT NULL DEFAULT '',solution TEXT NOT NULL DEFAULT '',startup_cost NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(startup_cost>=0),expected_monthly_revenue NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(expected_monthly_revenue>=0),expected_monthly_cost NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(expected_monthly_cost>=0),notes TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS forecasts (id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,title TEXT NOT NULL,starting_balance NUMERIC(14,2) NOT NULL DEFAULT 0,monthly_income NUMERIC(14,2) NOT NULL DEFAULT 0,monthly_expenses NUMERIC(14,2) NOT NULL DEFAULT 0,months INTEGER NOT NULL CHECK(months BETWEEN 1 AND 60),projection JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS budgets (id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,category TEXT NOT NULL,amount NUMERIC(14,2) NOT NULL CHECK(amount>0),period TEXT NOT NULL DEFAULT 'monthly' CHECK(period IN ('weekly','monthly','yearly')),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(user_id,category,period))");
  await pool.query("CREATE TABLE IF NOT EXISTS savings_goals (id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,title TEXT NOT NULL,target_amount NUMERIC(14,2) NOT NULL CHECK(target_amount>0),current_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(current_amount>=0),target_date DATE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
}
const text = (v, max=300) => typeof v === "string" ? v.trim().slice(0,max) : "";
const number = v => (typeof v === "number" || (typeof v === "string" && v.trim() !== "")) ? Number(v) : NaN;
const positive = v => Number.isFinite(number(v)) && number(v) > 0;
const nonnegative = v => Number.isFinite(number(v)) && number(v) >= 0;
function auth(req,res,next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i,"");
  if (!token) return res.status(401).json({error:"Sign in to continue."});
  try { const p=jwt.verify(token,secret,{issuer:"moneymind-api",audience:"moneymind-web"}); req.userId=String(p.sub); next(); }
  catch { return res.status(401).json({error:"Session invalid or expired. Please sign in again."}); }
}
function makeToken(user) { return jwt.sign({sub:String(user.id),email:user.email},secret,{expiresIn:"7d",issuer:"moneymind-api",audience:"moneymind-web"}); }
app.get("/api/health",(req,res)=>res.json({status:"ok",service:"MoneyMind API",version:"1.0.0"}));

app.post("/api/auth/register",async(req,res,next)=>{
  try {
    const email=text(req.body.email,254).toLowerCase(), password=typeof req.body.password==="string"?req.body.password:"", displayName=text(req.body.displayName,80);
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:"Enter a valid email address."});
    if(password.length<10||password.length>128)return res.status(400).json({error:"Password must be 10–128 characters."});
    const hash=await bcrypt.hash(password,12);
    const r=await pool.query("INSERT INTO users(email,password_hash,display_name) VALUES($1,$2,$3) RETURNING id,email,display_name,created_at",[email,hash,displayName]);
    res.status(201).json({user:r.rows[0],token:makeToken(r.rows[0])});
  } catch(e) { if(e.code==="23505")return res.status(409).json({error:"An account with this email already exists."}); next(e); }
});
app.post("/api/auth/login",async(req,res,next)=>{
  try {
    const email=text(req.body.email,254).toLowerCase(), password=typeof req.body.password==="string"?req.body.password:"";
    const r=await pool.query("SELECT id,email,display_name,created_at,password_hash FROM users WHERE email=$1",[email]);
    const u=r.rows[0];
    if(!u||!(await bcrypt.compare(password,u.password_hash)))return res.status(401).json({error:"Email or password is incorrect."});
    const user={id:u.id,email:u.email,display_name:u.display_name,created_at:u.created_at};
    res.json({user,token:makeToken(user)});
  }catch(e){next(e);}
});
app.get("/api/auth/me",auth,async(req,res,next)=>{
  try{const r=await pool.query("SELECT id,email,display_name,created_at FROM users WHERE id=$1",[req.userId]);if(!r.rowCount)return res.status(404).json({error:"Account not found."});res.json({user:r.rows[0]});}catch(e){next(e);}
});

app.get("/api/transactions",auth,async(req,res,next)=>{
  try{const limit=Math.min(Math.max(parseInt(req.query.limit,10)||100,1),500);const r=await pool.query("SELECT id,kind,amount,category,description,transaction_date,created_at FROM transactions WHERE user_id=$1 ORDER BY transaction_date DESC,id DESC LIMIT $2",[req.userId,limit]);res.json({transactions:r.rows});}catch(e){next(e);}
});
app.post("/api/transactions",auth,async(req,res,next)=>{
  try{
    const kind=req.body.kind,amount=req.body.amount,category=text(req.body.category,80),description=text(req.body.description,500),date=text(req.body.transaction_date||req.body.date,10);
    if(!["income","expense"].includes(kind))return res.status(400).json({error:"kind must be income or expense."});
    if(!positive(amount))return res.status(400).json({error:"amount must be positive."});
    if(!category)return res.status(400).json({error:"category is required."});
    if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))return res.status(400).json({error:"Date must use YYYY-MM-DD."});
    const r=await pool.query("INSERT INTO transactions(user_id,kind,amount,category,description,transaction_date) VALUES($1,$2,$3,$4,$5,COALESCE($6::date,CURRENT_DATE)) RETURNING id,kind,amount,category,description,transaction_date,created_at",[req.userId,kind,amount,category,description,date||null]);
    res.status(201).json({transaction:r.rows[0]});
  }catch(e){next(e);}
});
app.patch("/api/transactions/:id",auth,async(req,res,next)=>{
  try{
    const b=req.body;
    if(b.kind!==undefined&&!["income","expense"].includes(b.kind))return res.status(400).json({error:"Invalid kind."});
    if(b.amount!==undefined&&!positive(b.amount))return res.status(400).json({error:"amount must be positive."});
    if(b.category!==undefined&&!text(b.category,80))return res.status(400).json({error:"category cannot be empty."});
    const date=b.transaction_date||b.date;
    if(date!==undefined&&!/^\d{4}-\d{2}-\d{2}$/.test(String(date)))return res.status(400).json({error:"Date must use YYYY-MM-DD."});
    const q="UPDATE transactions SET kind=COALESCE($3,kind),amount=COALESCE($4,amount),category=COALESCE($5,category),description=COALESCE($6,description),transaction_date=COALESCE($7::date,transaction_date) WHERE id=$1 AND user_id=$2 RETURNING id,kind,amount,category,description,transaction_date,created_at";
    const r=await pool.query(q,[req.params.id,req.userId,b.kind??null,b.amount??null,b.category===undefined?null:text(b.category,80),b.description===undefined?null:text(b.description,500),date??null]);
    if(!r.rowCount)return res.status(404).json({error:"Transaction not found."});res.json({transaction:r.rows[0]});
  }catch(e){next(e);}
});
app.delete("/api/transactions/:id",auth,async(req,res,next)=>{
  try{const r=await pool.query("DELETE FROM transactions WHERE id=$1 AND user_id=$2 RETURNING id",[req.params.id,req.userId]);if(!r.rowCount)return res.status(404).json({error:"Transaction not found."});res.json({deleted:true});}catch(e){next(e);}
});
app.get("/api/summary",auth,async(req,res,next)=>{
  try{const r=await pool.query("SELECT COALESCE(SUM(amount) FILTER(WHERE kind='income'),0) income,COALESCE(SUM(amount) FILTER(WHERE kind='expense'),0) expenses,COUNT(*) transaction_count FROM transactions WHERE user_id=$1",[req.userId]);const x=r.rows[0];res.json({income:Number(x.income),expenses:Number(x.expenses),net:Number(x.income)-Number(x.expenses),transactionCount:Number(x.transaction_count)});}catch(e){next(e);}
});

app.get("/api/ideas",auth,async(req,res,next)=>{
  try{const r=await pool.query("SELECT id,title,industry,customer,problem,solution,startup_cost,expected_monthly_revenue,expected_monthly_cost,notes,created_at FROM business_ideas WHERE user_id=$1 ORDER BY created_at DESC",[req.userId]);res.json({ideas:r.rows});}catch(e){next(e);}
});
app.post("/api/ideas",auth,async(req,res,next)=>{
  try{
    const b=req.body,title=text(b.title,120),industry=text(b.industry,100),customer=text(b.customer,300),problem=text(b.problem,1000),solution=text(b.solution,1000),notes=text(b.notes,3000),startup=b.startup_cost??0,revenue=b.expected_monthly_revenue??0,cost=b.expected_monthly_cost??0;
    if(!title)return res.status(400).json({error:"Idea title is required."});
    if(!nonnegative(startup)||!nonnegative(revenue)||!nonnegative(cost))return res.status(400).json({error:"Financial estimates must be zero or greater."});
    const r=await pool.query("INSERT INTO business_ideas(user_id,title,industry,customer,problem,solution,startup_cost,expected_monthly_revenue,expected_monthly_cost,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",[req.userId,title,industry,customer,problem,solution,startup,revenue,cost,notes]);
    const i=r.rows[0],profit=Number(i.expected_monthly_revenue)-Number(i.expected_monthly_cost);
    res.status(201).json({idea:i,monthlyProfit:profit,breakEvenMonths:profit>0?Number(i.startup_cost)/profit:null,note:"Estimates only; not a guarantee of business success."});
  }catch(e){next(e);}
});
app.delete("/api/ideas/:id",auth,async(req,res,next)=>{
  try{const r=await pool.query("DELETE FROM business_ideas WHERE id=$1 AND user_id=$2 RETURNING id",[req.params.id,req.userId]);if(!r.rowCount)return res.status(404).json({error:"Idea not found."});res.json({deleted:true});}catch(e){next(e);}
});
app.post("/api/forecasts",auth,async(req,res,next)=>{
  try{
    const b=req.body,title=text(b.title,120)||"My forecast",start=b.starting_balance??0,income=b.monthly_income??0,expenses=b.monthly_expenses??0,months=Number(b.months??12);
    if(!nonnegative(start)||!nonnegative(income)||!nonnegative(expenses)||!Number.isInteger(months)||months<1||months>60)return res.status(400).json({error:"Use non-negative amounts and a forecast period from 1 to 60 months."});
    let balance=Number(start);const projection=[];
    for(let m=1;m<=months;m++){balance+=Number(income)-Number(expenses);projection.push({month:m,income:Number(income),expenses:Number(expenses),net:Number(income)-Number(expenses),projectedBalance:Math.round(balance*100)/100});}
    const r=await pool.query("INSERT INTO forecasts(user_id,title,starting_balance,monthly_income,monthly_expenses,months,projection) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING id,title,starting_balance,monthly_income,monthly_expenses,months,projection,created_at",[req.userId,title,start,income,expenses,months,JSON.stringify(projection)]);
    res.status(201).json({forecast:r.rows[0],disclaimer:"Assumes fixed monthly income and expenses; actual results will differ."});
  }catch(e){next(e);}
});
app.get("/api/forecasts",auth,async(req,res,next)=>{
  try{const r=await pool.query("SELECT id,title,starting_balance,monthly_income,monthly_expenses,months,projection,created_at FROM forecasts WHERE user_id=$1 ORDER BY created_at DESC",[req.userId]);res.json({forecasts:r.rows});}catch(e){next(e);}
});
app.delete("/api/forecasts/:id",auth,async(req,res,next)=>{
  try{const r=await pool.query("DELETE FROM forecasts WHERE id=$1 AND user_id=$2 RETURNING id",[req.params.id,req.userId]);if(!r.rowCount)return res.status(404).json({error:"Forecast not found."});res.json({deleted:true});}catch(e){next(e);}
});

app.get("/api/budgets",auth,async(req,res,next)=>{
  try {
    const r=await pool.query("SELECT b.id,b.category,b.amount,b.period,b.created_at,COALESCE(SUM(t.amount) FILTER(WHERE t.kind='expense' AND t.category=b.category AND date_trunc(CASE WHEN b.period='weekly' THEN 'week' WHEN b.period='yearly' THEN 'year' ELSE 'month' END,t.transaction_date::timestamp)=date_trunc(CASE WHEN b.period='weekly' THEN 'week' WHEN b.period='yearly' THEN 'year' ELSE 'month' END,CURRENT_DATE::timestamp)),0) AS spent FROM budgets b LEFT JOIN transactions t ON t.user_id=b.user_id WHERE b.user_id=$1 GROUP BY b.id ORDER BY b.category",[req.userId]);
    res.json({budgets:r.rows.map(b=>({...b,amount:Number(b.amount),spent:Number(b.spent),remaining:Number(b.amount)-Number(b.spent)}))});
  } catch(e){next(e);}
});
app.post("/api/budgets",auth,async(req,res,next)=>{
  try {
    const category=text(req.body.category,80),amount=req.body.amount,period=req.body.period||"monthly";
    if(!category)return res.status(400).json({error:"Budget category is required."});
    if(!positive(amount))return res.status(400).json({error:"Budget amount must be positive."});
    if(!["weekly","monthly","yearly"].includes(period))return res.status(400).json({error:"period must be weekly, monthly, or yearly."});
    const r=await pool.query("INSERT INTO budgets(user_id,category,amount,period) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,category,period) DO UPDATE SET amount=EXCLUDED.amount RETURNING id,category,amount,period,created_at",[req.userId,category,amount,period]);
    res.status(201).json({budget:r.rows[0]});
  } catch(e){next(e);}
});
app.patch("/api/budgets/:id",auth,async(req,res,next)=>{
  try {
    const b=req.body;
    if(b.amount!==undefined&&!positive(b.amount))return res.status(400).json({error:"Budget amount must be positive."});
    if(b.category!==undefined&&!text(b.category,80))return res.status(400).json({error:"Category cannot be empty."});
    if(b.period!==undefined&&!["weekly","monthly","yearly"].includes(b.period))return res.status(400).json({error:"Invalid budget period."});
    const r=await pool.query("UPDATE budgets SET category=COALESCE($3,category),amount=COALESCE($4,amount),period=COALESCE($5,period) WHERE id=$1 AND user_id=$2 RETURNING id,category,amount,period,created_at",[req.params.id,req.userId,b.category===undefined?null:text(b.category,80),b.amount??null,b.period??null]);
    if(!r.rowCount)return res.status(404).json({error:"Budget not found."});
    res.json({budget:r.rows[0]});
  } catch(e){if(e.code==="23505")return res.status(409).json({error:"A budget for that category and period already exists."});next(e);}
});
app.delete("/api/budgets/:id",auth,async(req,res,next)=>{
  try{const r=await pool.query("DELETE FROM budgets WHERE id=$1 AND user_id=$2 RETURNING id",[req.params.id,req.userId]);if(!r.rowCount)return res.status(404).json({error:"Budget not found."});res.json({deleted:true});}catch(e){next(e);}
});

app.get("/api/savings-goals",auth,async(req,res,next)=>{
  try{const r=await pool.query("SELECT id,title,target_amount,current_amount,target_date,created_at FROM savings_goals WHERE user_id=$1 ORDER BY created_at DESC",[req.userId]);res.json({goals:r.rows.map(g=>({...g,target_amount:Number(g.target_amount),current_amount:Number(g.current_amount),remaining:Math.max(0,Number(g.target_amount)-Number(g.current_amount)),progress:Math.min(100,Math.round(Number(g.current_amount)/Number(g.target_amount)*10000)/100)}))});}catch(e){next(e);}
});
app.post("/api/savings-goals",auth,async(req,res,next)=>{
  try{
    const title=text(req.body.title,120),target=req.body.target_amount,current=req.body.current_amount??0,date=text(req.body.target_date,10);
    if(!title)return res.status(400).json({error:"Savings goal title is required."});
    if(!positive(target)||!nonnegative(current))return res.status(400).json({error:"Target must be positive and current savings cannot be negative."});
    if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))return res.status(400).json({error:"Target date must use YYYY-MM-DD."});
    const r=await pool.query("INSERT INTO savings_goals(user_id,title,target_amount,current_amount,target_date) VALUES($1,$2,$3,$4,$5::date) RETURNING id,title,target_amount,current_amount,target_date,created_at",[req.userId,title,target,current,date||null]);
    const g=r.rows[0];res.status(201).json({goal:{...g,target_amount:Number(g.target_amount),current_amount:Number(g.current_amount),remaining:Math.max(0,Number(g.target_amount)-Number(g.current_amount)),progress:Math.min(100,Math.round(Number(g.current_amount)/Number(g.target_amount)*10000)/100)}});
  }catch(e){next(e);}
});
app.patch("/api/savings-goals/:id",auth,async(req,res,next)=>{
  try{
    const b=req.body;
    if(b.target_amount!==undefined&&!positive(b.target_amount))return res.status(400).json({error:"Target amount must be positive."});
    if(b.current_amount!==undefined&&!nonnegative(b.current_amount))return res.status(400).json({error:"Current amount cannot be negative."});
    if(b.title!==undefined&&!text(b.title,120))return res.status(400).json({error:"Goal title cannot be empty."});
    const date=b.target_date===undefined?null:(b.target_date===""?null:text(b.target_date,10));
    if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))return res.status(400).json({error:"Target date must use YYYY-MM-DD."});
    const r=await pool.query("UPDATE savings_goals SET title=COALESCE($3,title),target_amount=COALESCE($4,target_amount),current_amount=COALESCE($5,current_amount),target_date=CASE WHEN $6 THEN $7::date ELSE target_date END WHERE id=$1 AND user_id=$2 RETURNING id,title,target_amount,current_amount,target_date,created_at",[req.params.id,req.userId,b.title===undefined?null:text(b.title,120),b.target_amount??null,b.current_amount??null,b.target_date!==undefined,date]);
    if(!r.rowCount)return res.status(404).json({error:"Savings goal not found."});
    const g=r.rows[0];res.json({goal:{...g,target_amount:Number(g.target_amount),current_amount:Number(g.current_amount),remaining:Math.max(0,Number(g.target_amount)-Number(g.current_amount)),progress:Math.min(100,Math.round(Number(g.current_amount)/Number(g.target_amount)*10000)/100)}});
  }catch(e){next(e);}
});
app.delete("/api/savings-goals/:id",auth,async(req,res,next)=>{
  try{const r=await pool.query("DELETE FROM savings_goals WHERE id=$1 AND user_id=$2 RETURNING id",[req.params.id,req.userId]);if(!r.rowCount)return res.status(404).json({error:"Savings goal not found."});res.json({deleted:true});}catch(e){next(e);}
});

app.use((req,res)=>res.status(404).json({error:"API route not found."}));
app.use((err,req,res,next)=>{
  console.error("API error:",err.message);
  if(res.headersSent)return next(err);
  if(err.message==="Origin not allowed by CORS")return res.status(403).json({error:"This website origin is not allowed."});
  res.status(500).json({error:"Something went wrong. Please try again."});
});
initDb().then(()=>app.listen(port,()=>console.log("MoneyMind API listening on port "+port))).catch(e=>{console.error("Database initialization failed:",e.message);process.exit(1);});
