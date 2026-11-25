/**
 * Seeded, realistic datasets. Small "shop" tables are kept tiny on purpose so every row
 * fits on screen while a query is stepped through; the `big_*` tables (loaded on demand
 * for performance lessons) are large enough for the planner to make real choices.
 *
 * Everything is deterministic: same rows, same plans, every time.
 */

export interface ColumnDoc {
  name: string;
  type: string;
  note?: string;
}
export interface TableDoc {
  name: string;
  rows: string;
  about: string;
  columns: ColumnDoc[];
  perf?: boolean;
}

export const SCHEMA: TableDoc[] = [
  {
    name: 'users',
    rows: '10',
    about: 'Customers. Two have no country (NULL), two never ordered, referred_by points at another user.',
    columns: [
      { name: 'id', type: 'int', note: 'PK' },
      { name: 'name', type: 'text' },
      { name: 'email', type: 'text', note: 'UNIQUE' },
      { name: 'country', type: 'text', note: 'nullable' },
      { name: 'plan', type: 'text', note: "'free' | 'pro' | 'enterprise'" },
      { name: 'signup_date', type: 'date' },
      { name: 'referred_by', type: 'int', note: 'FK users.id, nullable' },
    ],
  },
  {
    name: 'products',
    rows: '8',
    about: 'Catalog. "Pen Set" has never been ordered.',
    columns: [
      { name: 'id', type: 'int', note: 'PK' },
      { name: 'name', type: 'text' },
      { name: 'category', type: 'text', note: 'electronics | furniture | stationery' },
      { name: 'price', type: 'numeric(10,2)' },
    ],
  },
  {
    name: 'orders',
    rows: '16',
    about: 'One row per order. Order 16 is a guest checkout (user_id NULL). amount = sum of its items.',
    columns: [
      { name: 'id', type: 'int', note: 'PK' },
      { name: 'user_id', type: 'int', note: 'FK users.id, NULL for guests' },
      { name: 'ordered_at', type: 'timestamp' },
      { name: 'status', type: 'text', note: "'paid' | 'pending' | 'refunded'" },
      { name: 'amount', type: 'numeric(10,2)' },
    ],
  },
  {
    name: 'order_items',
    rows: '25',
    about: 'Line items: several per order (the classic fan-out source).',
    columns: [
      { name: 'order_id', type: 'int', note: 'FK orders.id' },
      { name: 'product_id', type: 'int', note: 'FK products.id' },
      { name: 'qty', type: 'int' },
      { name: 'unit_price', type: 'numeric(10,2)' },
    ],
  },
  {
    name: 'payments',
    rows: '14',
    about: 'Payments per order. Orders 2 and 8 were paid in 2 installments; pending orders have none.',
    columns: [
      { name: 'id', type: 'int', note: 'PK' },
      { name: 'order_id', type: 'int', note: 'FK orders.id' },
      { name: 'paid_at', type: 'timestamp' },
      { name: 'amount', type: 'numeric(10,2)' },
      { name: 'method', type: 'text', note: "'card' | 'paypal' | 'giftcard'" },
    ],
  },
  {
    name: 'events',
    rows: '36',
    about: 'Clickstream for 5 users over 2 days: view → add_to_cart → checkout → purchase. Gaps > 30 min split sessions.',
    columns: [
      { name: 'id', type: 'int', note: 'PK' },
      { name: 'user_id', type: 'int' },
      { name: 'event_time', type: 'timestamp' },
      { name: 'event_type', type: 'text', note: "'view' | 'add_to_cart' | 'checkout' | 'purchase'" },
      { name: 'page', type: 'text' },
    ],
  },
  {
    name: 'logins',
    rows: '27',
    about: 'Daily logins (March 2024) for 4 users, with streaks, gaps and one duplicate login (user 2 on Mar 4).',
    columns: [
      { name: 'user_id', type: 'int' },
      { name: 'login_date', type: 'date' },
    ],
  },
  {
    name: 'employees',
    rows: '12',
    about: 'Org chart: CEO → VPs → ICs. Salary ties exist; Tom (IC) out-earns his manager Priya.',
    columns: [
      { name: 'id', type: 'int', note: 'PK' },
      { name: 'name', type: 'text' },
      { name: 'manager_id', type: 'int', note: 'FK employees.id, NULL for the CEO' },
      { name: 'dept', type: 'text' },
      { name: 'salary', type: 'int' },
      { name: 'hired_at', type: 'date' },
    ],
  },
  {
    name: 'customer_tiers',
    rows: '9',
    about: 'SCD type 2 history of each user tier: one row per version, valid_to NULL = current.',
    columns: [
      { name: 'user_id', type: 'int' },
      { name: 'tier', type: 'text', note: "'bronze' | 'silver' | 'gold'" },
      { name: 'valid_from', type: 'date' },
      { name: 'valid_to', type: 'date', note: 'exclusive, NULL = current' },
      { name: 'is_current', type: 'boolean' },
    ],
  },
  {
    name: 'routes',
    rows: '9',
    about: 'Directed flight graph with minutes per hop (contains a cycle SFO → SEA → SFO).',
    columns: [
      { name: 'src', type: 'text' },
      { name: 'dst', type: 'text' },
      { name: 'minutes', type: 'int' },
    ],
  },
  {
    name: 'requests',
    rows: '20',
    about: 'API request log for latency percentiles (p50/p95/p99) per endpoint.',
    columns: [
      { name: 'id', type: 'int', note: 'PK' },
      { name: 'endpoint', type: 'text', note: "'/search' | '/checkout'" },
      { name: 'latency_ms', type: 'int' },
      { name: 'at', type: 'timestamp' },
    ],
  },
  {
    name: 'staging_users',
    rows: '6',
    about: 'Raw CDC feed to dedupe / upsert into users: duplicates, mixed-case emails, newer versions of existing users.',
    columns: [
      { name: 'email', type: 'text' },
      { name: 'name', type: 'text' },
      { name: 'country', type: 'text' },
      { name: 'updated_at', type: 'timestamp' },
    ],
  },
  {
    name: 'accounts',
    rows: '3',
    about: 'Bank-style balances used by the transaction lessons.',
    columns: [
      { name: 'id', type: 'int', note: 'PK' },
      { name: 'owner', type: 'text' },
      { name: 'balance', type: 'int' },
    ],
  },
  {
    name: 'big_users',
    rows: '20 000',
    perf: true,
    about: 'Performance table (loaded on demand). Only the PK is indexed — add your own indexes.',
    columns: [
      { name: 'id', type: 'int', note: 'PK' },
      { name: 'email', type: 'text' },
      { name: 'country', type: 'text', note: '7 values, skewed to US/IN' },
      { name: 'created_at', type: 'timestamp' },
    ],
  },
  {
    name: 'big_orders',
    rows: '200 000',
    perf: true,
    about: "Performance table (loaded on demand). status is skewed: ~94% 'delivered', ~1% 'pending'. created_at grows with id. Only the PK is indexed.",
    columns: [
      { name: 'id', type: 'int', note: 'PK' },
      { name: 'user_id', type: 'int', note: '1..20000' },
      { name: 'status', type: 'text', note: 'delivered | shipped | cancelled | pending' },
      { name: 'created_at', type: 'timestamp', note: '2023-01-01 … 2024-12-31' },
      { name: 'amount', type: 'numeric(10,2)' },
    ],
  },
];

export const SEED_SQL = /* sql */ `
SET TimeZone = 'UTC';

CREATE TABLE users (
  id int PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  country text,
  plan text NOT NULL,
  signup_date date NOT NULL,
  referred_by int REFERENCES users(id)
);
INSERT INTO users VALUES
 (1,'Asha','asha@mail.com','IN','pro','2024-01-05',NULL),
 (2,'Ben','ben@mail.com','US','free','2024-01-12',1),
 (3,'Chen','chen@mail.com','CN','free','2024-01-20',1),
 (4,'Dana','dana@mail.com','US','pro','2024-02-02',2),
 (5,'Eli','eli@mail.com',NULL,'free','2024-02-10',2),
 (6,'Fatima','fatima@mail.com','AE','enterprise','2024-02-18',NULL),
 (7,'Goran','goran@mail.com','DE','free','2024-03-01',4),
 (8,'Hana','hana@mail.com','JP','pro','2024-03-03',NULL),
 (9,'Ivan','ivan@mail.com',NULL,'free','2024-03-09',4),
 (10,'Jo','jo@mail.com','US','free','2024-03-15',NULL);

CREATE TABLE products (
  id int PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL,
  price numeric(10,2) NOT NULL
);
INSERT INTO products VALUES
 (1,'Keyboard','electronics',80),
 (2,'Mouse','electronics',25),
 (3,'Monitor','electronics',300),
 (4,'Desk','furniture',450),
 (5,'Chair','furniture',200),
 (6,'Lamp','furniture',40),
 (7,'Notebook','stationery',5),
 (8,'Pen Set','stationery',12);

CREATE TABLE orders (
  id int PRIMARY KEY,
  user_id int REFERENCES users(id),
  ordered_at timestamp NOT NULL,
  status text NOT NULL,
  amount numeric(10,2)
);
INSERT INTO orders (id,user_id,ordered_at,status) VALUES
 (1,1,'2024-01-06 10:15','paid'),
 (2,1,'2024-01-20 18:40','paid'),
 (3,2,'2024-01-13 09:05','paid'),
 (4,2,'2024-02-14 21:30','refunded'),
 (5,3,'2024-01-25 12:00','paid'),
 (6,4,'2024-02-03 08:20','paid'),
 (7,4,'2024-02-03 19:45','pending'),
 (8,4,'2024-03-10 14:10','paid'),
 (9,5,'2024-02-11 16:00','paid'),
 (10,6,'2024-02-19 11:11','paid'),
 (11,6,'2024-03-02 13:30','paid'),
 (12,6,'2024-03-20 10:00','pending'),
 (13,7,'2024-03-02 17:25','paid'),
 (14,8,'2024-03-04 09:50','refunded'),
 (15,1,'2024-03-05 20:05','paid'),
 (16,NULL,'2024-03-06 15:45','paid');

CREATE TABLE order_items (
  order_id int NOT NULL REFERENCES orders(id),
  product_id int NOT NULL REFERENCES products(id),
  qty int NOT NULL,
  unit_price numeric(10,2) NOT NULL,
  PRIMARY KEY (order_id, product_id)
);
INSERT INTO order_items VALUES
 (1,1,1,80),(1,2,2,25),
 (2,3,1,300),
 (3,7,4,5),(3,2,1,25),
 (4,5,1,200),
 (5,4,1,450),(5,6,1,40),
 (6,1,1,80),(6,3,2,300),
 (7,7,10,5),
 (8,5,2,200),(8,6,2,40),
 (9,2,1,25),
 (10,4,2,450),(10,5,2,200),(10,3,1,300),
 (11,1,1,80),
 (12,6,3,40),
 (13,7,2,5),(13,2,1,25),
 (14,3,1,300),
 (15,6,1,40),(15,7,6,5),
 (16,2,2,25);
UPDATE orders o SET amount = (SELECT sum(qty * unit_price) FROM order_items i WHERE i.order_id = o.id);

CREATE TABLE payments (
  id int PRIMARY KEY,
  order_id int NOT NULL REFERENCES orders(id),
  paid_at timestamp NOT NULL,
  amount numeric(10,2) NOT NULL,
  method text NOT NULL
);
INSERT INTO payments VALUES
 (1,1,'2024-01-06 10:16',130,'card'),
 (2,2,'2024-01-20 18:41',150,'card'),
 (3,2,'2024-02-20 18:41',150,'card'),
 (4,3,'2024-01-13 09:06',45,'paypal'),
 (5,4,'2024-02-14 21:31',200,'card'),
 (6,5,'2024-01-25 12:01',490,'card'),
 (7,6,'2024-02-03 08:21',680,'paypal'),
 (8,8,'2024-03-10 14:11',240,'card'),
 (9,8,'2024-04-10 14:11',240,'card'),
 (10,9,'2024-02-11 16:01',25,'giftcard'),
 (11,10,'2024-02-19 11:12',1600,'card'),
 (12,11,'2024-03-02 13:31',80,'card'),
 (13,13,'2024-03-02 17:26',35,'paypal'),
 (14,15,'2024-03-05 20:06',70,'card');

CREATE TABLE events (
  id int PRIMARY KEY,
  user_id int NOT NULL,
  event_time timestamp NOT NULL,
  event_type text NOT NULL,
  page text NOT NULL
);
INSERT INTO events VALUES
 (1,1,'2024-03-01 09:00','view','/home'),
 (2,1,'2024-03-01 09:05','view','/p/keyboard'),
 (3,1,'2024-03-01 09:07','add_to_cart','/p/keyboard'),
 (4,1,'2024-03-01 09:20','checkout','/cart'),
 (5,1,'2024-03-01 09:22','purchase','/checkout'),
 (6,1,'2024-03-01 14:00','view','/home'),
 (7,1,'2024-03-01 14:10','view','/p/lamp'),
 (8,2,'2024-03-01 10:00','view','/home'),
 (9,2,'2024-03-01 10:02','view','/p/mouse'),
 (10,2,'2024-03-01 10:03','add_to_cart','/p/mouse'),
 (11,2,'2024-03-01 10:50','view','/cart'),
 (12,2,'2024-03-01 10:55','checkout','/cart'),
 (13,3,'2024-03-01 11:00','view','/home'),
 (14,3,'2024-03-01 11:01','view','/p/desk'),
 (15,3,'2024-03-01 11:40','view','/p/chair'),
 (16,3,'2024-03-01 11:45','add_to_cart','/p/chair'),
 (17,3,'2024-03-01 12:30','view','/home'),
 (18,4,'2024-03-01 08:00','view','/home'),
 (19,4,'2024-03-01 08:01','add_to_cart','/p/monitor'),
 (20,4,'2024-03-01 08:03','checkout','/cart'),
 (21,4,'2024-03-01 08:04','purchase','/checkout'),
 (22,4,'2024-03-02 08:00','view','/home'),
 (23,4,'2024-03-02 08:10','view','/p/chair'),
 (24,4,'2024-03-02 08:12','add_to_cart','/p/chair'),
 (25,4,'2024-03-02 08:15','checkout','/cart'),
 (26,4,'2024-03-02 08:16','purchase','/checkout'),
 (27,5,'2024-03-01 20:00','view','/home'),
 (28,5,'2024-03-01 20:10','view','/p/mouse'),
 (29,5,'2024-03-01 20:25','view','/p/keyboard'),
 (30,5,'2024-03-01 20:50','view','/p/monitor'),
 (31,5,'2024-03-01 21:30','view','/home'),
 (32,5,'2024-03-02 21:00','view','/home'),
 (33,5,'2024-03-02 21:02','add_to_cart','/p/mouse'),
 (34,5,'2024-03-02 21:10','checkout','/cart'),
 (35,2,'2024-03-02 07:30','view','/home'),
 (36,2,'2024-03-02 07:31','view','/p/lamp');

CREATE TABLE logins (
  user_id int NOT NULL,
  login_date date NOT NULL
);
INSERT INTO logins VALUES
 (1,'2024-03-01'),(1,'2024-03-02'),(1,'2024-03-03'),(1,'2024-03-05'),(1,'2024-03-06'),
 (1,'2024-03-07'),(1,'2024-03-08'),(1,'2024-03-12'),
 (2,'2024-03-01'),(2,'2024-03-03'),(2,'2024-03-04'),(2,'2024-03-04'),(2,'2024-03-05'),
 (2,'2024-03-10'),(2,'2024-03-11'),
 (3,'2024-03-02'),(3,'2024-03-09'),(3,'2024-03-10'),(3,'2024-03-11'),(3,'2024-03-12'),
 (3,'2024-03-13'),(3,'2024-03-14'),
 (4,'2024-03-01'),(4,'2024-03-02'),(4,'2024-03-08'),(4,'2024-03-15'),(4,'2024-03-16');

CREATE TABLE employees (
  id int PRIMARY KEY,
  name text NOT NULL,
  manager_id int REFERENCES employees(id),
  dept text NOT NULL,
  salary int NOT NULL,
  hired_at date NOT NULL
);
INSERT INTO employees VALUES
 (1,'Maya',NULL,'Exec',250000,'2015-03-01'),
 (2,'Noah',1,'Engineering',190000,'2016-06-15'),
 (3,'Olga',1,'Sales',170000,'2017-01-10'),
 (4,'Priya',2,'Engineering',150000,'2018-04-01'),
 (5,'Quinn',2,'Engineering',150000,'2019-09-23'),
 (6,'Ravi',2,'Engineering',135000,'2020-02-11'),
 (7,'Sara',4,'Engineering',120000,'2021-07-19'),
 (8,'Tom',4,'Engineering',165000,'2021-11-02'),
 (9,'Uma',3,'Sales',95000,'2019-05-06'),
 (10,'Vik',3,'Sales',110000,'2020-08-30'),
 (11,'Wen',3,'Sales',110000,'2022-01-17'),
 (12,'Xia',9,'Sales',70000,'2023-03-27');

CREATE TABLE customer_tiers (
  user_id int NOT NULL,
  tier text NOT NULL,
  valid_from date NOT NULL,
  valid_to date,
  is_current boolean NOT NULL
);
INSERT INTO customer_tiers VALUES
 (1,'bronze','2024-01-05','2024-01-21',false),
 (1,'silver','2024-01-21','2024-03-01',false),
 (1,'gold','2024-03-01',NULL,true),
 (2,'bronze','2024-01-12',NULL,true),
 (4,'bronze','2024-02-02','2024-03-01',false),
 (4,'silver','2024-03-01',NULL,true),
 (6,'silver','2024-02-18','2024-03-01',false),
 (6,'gold','2024-03-01',NULL,true),
 (8,'bronze','2024-03-03',NULL,true);

CREATE TABLE routes (
  src text NOT NULL,
  dst text NOT NULL,
  minutes int NOT NULL
);
INSERT INTO routes VALUES
 ('SFO','SEA',120),('SEA','SFO',125),('SFO','DEN',150),('SEA','ORD',240),
 ('DEN','ORD',140),('DEN','JFK',230),('ORD','JFK',130),('ORD','BOS',125),('JFK','BOS',75);

CREATE TABLE requests (
  id int PRIMARY KEY,
  endpoint text NOT NULL,
  latency_ms int NOT NULL,
  at timestamp NOT NULL
);
INSERT INTO requests VALUES
 (1,'/search',42,'2024-03-01 10:00:01'),(2,'/search',38,'2024-03-01 10:00:02'),
 (3,'/search',51,'2024-03-01 10:00:03'),(4,'/search',47,'2024-03-01 10:00:04'),
 (5,'/search',40,'2024-03-01 10:00:05'),(6,'/search',300,'2024-03-01 10:00:06'),
 (7,'/search',45,'2024-03-01 10:00:07'),(8,'/search',39,'2024-03-01 10:00:08'),
 (9,'/search',60,'2024-03-01 10:00:09'),(10,'/search',1200,'2024-03-01 10:00:10'),
 (11,'/checkout',180,'2024-03-01 10:00:01'),(12,'/checkout',210,'2024-03-01 10:00:02'),
 (13,'/checkout',190,'2024-03-01 10:00:03'),(14,'/checkout',950,'2024-03-01 10:00:04'),
 (15,'/checkout',205,'2024-03-01 10:00:05'),(16,'/checkout',175,'2024-03-01 10:00:06'),
 (17,'/checkout',2400,'2024-03-01 10:00:07'),(18,'/checkout',220,'2024-03-01 10:00:08'),
 (19,'/checkout',199,'2024-03-01 10:00:09'),(20,'/checkout',185,'2024-03-01 10:00:10');

CREATE TABLE staging_users (
  email text NOT NULL,
  name text NOT NULL,
  country text,
  updated_at timestamp NOT NULL
);
INSERT INTO staging_users VALUES
 ('Eli@Mail.com','Eli','PT','2024-03-20 09:00'),
 ('eli@mail.com','Eli R.','PT','2024-03-21 09:00'),
 ('kim@mail.com','Kim','KR','2024-03-20 10:00'),
 ('kim@mail.com','Kim','KR','2024-03-20 10:00'),
 ('lea@mail.com','Lea','FR','2024-03-19 12:00'),
 ('IVAN@mail.com','Ivan','RS','2024-03-22 08:00');

CREATE TABLE accounts (
  id int PRIMARY KEY,
  owner text NOT NULL,
  balance int NOT NULL
);
INSERT INTO accounts VALUES (1,'alice',100),(2,'bob',50),(3,'carol',0);

ANALYZE;
`;

/** Large tables for performance lessons. Deterministic via setseed. */
export const PERF_SQL = /* sql */ `
SELECT setseed(0.42);
CREATE TABLE big_users (
  id int PRIMARY KEY,
  email text NOT NULL,
  country text NOT NULL,
  created_at timestamp NOT NULL
);
INSERT INTO big_users
SELECT i,
       'user' || i || '@mail.com',
       (ARRAY['US','US','US','IN','IN','DE','BR','JP','FR','AE'])[1 + floor(random() * 10)::int],
       timestamp '2022-01-01' + (random() * 730) * interval '1 day'
FROM generate_series(1, 20000) AS g(i);

CREATE TABLE big_orders (
  id int PRIMARY KEY,
  user_id int NOT NULL,
  status text NOT NULL,
  created_at timestamp NOT NULL,
  amount numeric(10,2) NOT NULL
);
INSERT INTO big_orders
SELECT i,
       1 + floor(random() * 20000)::int,
       CASE WHEN r < 0.94 THEN 'delivered' WHEN r < 0.97 THEN 'shipped' WHEN r < 0.99 THEN 'cancelled' ELSE 'pending' END,
       timestamp '2023-01-01' + (i / 200000.0) * interval '730 days' + (random() * 3600) * interval '1 second',
       round((5 + random() * 495)::numeric, 2)
FROM (SELECT i, random() AS r FROM generate_series(1, 200000) AS g(i)) s;
ANALYZE big_users;
ANALYZE big_orders;
`;

/** Tables that only exist after `ensurePerf()`. */
export const PERF_TABLES = ['big_users', 'big_orders'];
export const needsPerf = (sql: string) => /\bbig_(users|orders)\b/i.test(sql);
