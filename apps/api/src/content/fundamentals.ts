import type { Answer, Difficulty, Option } from "@playcode/core";
import type { SeedQuestion, Verify } from "./questions";
import type { SeedSkill } from "./skills";

// CS fundamentals for service-company tests (TCS NQT, Infosys, Wipro,
// Accenture): DBMS, operating systems and computer networks, as concept
// questions with no code. Where the answer can be computed (scheduling, page
// faults, subnetting, keys from functional dependencies, a rolled-back
// transaction), `verify` holds a program that prints the correct option, and
// `pnpm verify:content` runs it.

export const FUNDAMENTAL_SKILLS: SeedSkill[] = [
  { id: "dbms.keys", topic: "dbms", topicName: "DBMS", name: "Keys and normalisation" },
  { id: "dbms.transactions", topic: "dbms", topicName: "DBMS", name: "Transactions" },
  { id: "os.scheduling", topic: "os", topicName: "Operating systems", name: "Processes and scheduling" },
  { id: "os.memory", topic: "os", topicName: "Operating systems", name: "Memory and deadlocks" },
  { id: "networks.layers", topic: "networks", topicName: "Computer networks", name: "Layers and protocols" },
  { id: "networks.addressing", topic: "networks", topicName: "Computer networks", name: "IP addressing" },
];

const IDS = "abcd";
const opts = (...texts: string[]): Option[] => texts.map((text, i) => ({ id: IDS[i]!, text }));
const pick = (index: number): Answer => ({ kind: "option", optionId: IDS[index]! });

/** A no-code multiple-choice question; `verify` is a Python program that prints the correct option. */
export function concept(
  base: { id: string; skillId: string; difficulty: Difficulty; stem: string; explanation: string; hints?: string[]; verify?: string; tag?: string },
  options: string[],
  correct: number,
): SeedQuestion {
  const verify: Verify | undefined = base.verify ? { runner: "python", program: base.verify } : undefined;
  return {
    id: base.id,
    type: "concept",
    skillId: base.skillId,
    difficulty: base.difficulty,
    body: { stem: base.stem, language: "theory", options: opts(...options) },
    answer: pick(correct),
    explanation: base.explanation,
    hints: base.hints ?? [],
    tags: [base.tag ?? "service_fundamentals"],
    verify,
  };
}

/** Python that prints the candidate keys of a relation, given its attributes and functional dependencies. */
const keysProgram = (attrs: string, fds: [string, string][]) => `
from itertools import combinations
attrs = "${attrs}"
fds = ${JSON.stringify(fds)}
def closure(s):
    s = set(s)
    changed = True
    while changed:
        changed = False
        for lhs, rhs in fds:
            if set(lhs) <= s and not set(rhs) <= s:
                s |= set(rhs)
                changed = True
    return s
keys = []
for n in range(1, len(attrs) + 1):
    for combo in combinations(attrs, n):
        if closure(combo) == set(attrs) and not any(set(k) <= set(combo) for k in keys):
            keys.append("".join(combo))
print(", ".join(keys))`;

const pageFaults = (policy: "fifo" | "lru", refs: number[], frames: number) => `
refs = ${JSON.stringify(refs)}
frames, faults = [], 0
for p in refs:
    if p in frames:
        ${policy === "lru" ? "frames.remove(p)\n        frames.append(p)" : "pass"}
        continue
    faults += 1
    if len(frames) == ${frames}:
        frames.pop(0)
    frames.append(p)
print(faults)`;

const REFS = [7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2];

export const FUNDAMENTAL_QUESTIONS: SeedQuestion[] = [
  // ---------------- DBMS: keys and normalisation ----------------
  concept(
    {
      id: "dbms-keys-1", skillId: "dbms.keys", difficulty: 1,
      stem: "A relation R(A, B, C) has the functional dependencies A → B and B → C. What is the candidate key of R?",
      explanation: "From A we get B, and from B we get C, so A determines every attribute. No smaller set does, so A is the key.",
      hints: ["Find the closure of each attribute: everything it determines."],
      verify: keysProgram("ABC", [["A", "B"], ["B", "C"]]),
    },
    ["A", "B", "AB", "C"], 0,
  ),
  concept(
    {
      id: "dbms-keys-2", skillId: "dbms.keys", difficulty: 2,
      stem: "Which normal form removes transitive dependencies, where a non-key attribute depends on another non-key attribute?",
      explanation: "2NF removes partial dependencies on part of a composite key; 3NF also removes transitive dependencies (key → X → Y). BCNF is stricter than 3NF, so it isn't the form that first removes them.",
      hints: ["1NF is about atomic values, 2NF about partial dependencies."],
    },
    ["Third normal form (3NF)", "First normal form (1NF)", "Second normal form (2NF)", "None: normal forms don't deal with dependencies"], 0,
  ),
  concept(
    {
      id: "dbms-keys-3", skillId: "dbms.keys", difficulty: 2,
      stem: "R(A, B, C, D) has the key (A, B) and the dependency B → C. What is the highest normal form R is in?",
      explanation: "C depends on B, which is only part of the key (A, B). That partial dependency breaks 2NF, so R is only in 1NF.",
      hints: ["Does any attribute depend on part of the key?"],
    },
    ["1NF", "2NF", "3NF", "BCNF"], 0,
  ),
  concept(
    {
      id: "dbms-keys-4", skillId: "dbms.keys", difficulty: 3,
      stem: "R(A, B, C, D, E) has the dependencies A → B, BC → D and D → E. Which set is a candidate key?",
      explanation: "A+ = {A, B}. AC+: A gives B, then BC gives D, then D gives E, so AC+ is every attribute. Nothing determines A or C, so both must be in every key: AC is the only candidate key.",
      hints: ["Which attributes never appear on the right of a dependency? They must be in every key."],
      verify: keysProgram("ABCDE", [["A", "B"], ["BC", "D"], ["D", "E"]]),
    },
    ["AC", "AB", "BC", "A"], 0,
  ),

  // ---------------- DBMS: transactions ----------------
  concept(
    {
      id: "dbms-txn-1", skillId: "dbms.transactions", difficulty: 1,
      stem: "A bank transfer debits one account and credits another. Which ACID property makes sure that either both happen or neither does?",
      explanation: "Atomicity: a transaction is all or nothing. Consistency is about rules (like balances never negative), isolation about concurrent transactions, durability about surviving crashes after commit.",
    },
    ["Atomicity", "Consistency", "Isolation", "Durability"], 0,
  ),
  concept(
    {
      id: "dbms-txn-2", skillId: "dbms.transactions", difficulty: 2,
      stem: "Transaction T1 reads a value that T2 has written but not committed, and T2 then rolls back. What is this problem called?",
      explanation: "A dirty read: T1 used data that never officially existed. A non-repeatable read is reading the same row twice and getting different committed values; a phantom is new rows appearing in a repeated query.",
    },
    ["Dirty read", "Phantom read", "Lost update", "Non-repeatable read"], 0,
  ),
  concept(
    {
      id: "dbms-txn-3", skillId: "dbms.transactions", difficulty: 2,
      stem: "Which isolation level prevents dirty reads but still allows non-repeatable reads?",
      explanation: "Read committed only lets a transaction see committed data, so no dirty reads, but a row read twice can change in between. Repeatable read prevents that too; read uncommitted allows dirty reads.",
    },
    ["Read committed", "Read uncommitted", "Repeatable read", "Serializable"], 0,
  ),
  concept(
    {
      id: "dbms-txn-4", skillId: "dbms.transactions", difficulty: 1,
      stem: "Table t has three rows. A session runs BEGIN; DELETE FROM t WHERE x > 1; ROLLBACK; and then SELECT COUNT(*) FROM t. What does the count return?",
      explanation: "ROLLBACK undoes everything since BEGIN, so the deleted rows come back: 3.",
      verify: `
import sqlite3
db = sqlite3.connect(":memory:", isolation_level=None)
db.execute("CREATE TABLE t (x INTEGER)")
db.executemany("INSERT INTO t VALUES (?)", [(1,), (2,), (3,)])
db.execute("BEGIN")
db.execute("DELETE FROM t WHERE x > 1")
db.execute("ROLLBACK")
print(db.execute("SELECT COUNT(*) FROM t").fetchone()[0])`,
    },
    ["3", "1", "0", "2"], 0,
  ),

  // ---------------- OS: processes and scheduling ----------------
  concept(
    {
      id: "os-sched-1", skillId: "os.scheduling", difficulty: 2,
      stem: "Processes P1, P2 and P3 arrive at time 0 in that order with CPU bursts of 24, 3 and 3 ms. With first-come first-served scheduling, what is the average waiting time in ms?",
      explanation: "P1 waits 0, P2 waits 24, P3 waits 27: (0 + 24 + 27) / 3 = 17 ms. One long job first makes everyone wait (the convoy effect).",
      hints: ["Each process waits for the bursts of everyone before it."],
      verify: `
bursts = [24, 3, 3]
t, waits = 0, []
for b in bursts:
    waits.append(t)
    t += b
print(sum(waits) // len(waits))`,
    },
    ["17", "3", "13", "27"], 0,
  ),
  concept(
    {
      id: "os-sched-2", skillId: "os.scheduling", difficulty: 2,
      stem: "The same three processes (bursts 24, 3 and 3 ms, all arriving at time 0) run under non-preemptive shortest-job-first. What is the average waiting time in ms?",
      explanation: "SJF runs 3, 3, then 24: waits 0, 3 and 6, so (0 + 3 + 6) / 3 = 3 ms. SJF gives the minimum average waiting time.",
      verify: `
bursts = sorted([24, 3, 3])
t, waits = 0, []
for b in bursts:
    waits.append(t)
    t += b
print(sum(waits) // len(waits))`,
    },
    ["3", "17", "6", "9"], 0,
  ),
  concept(
    {
      id: "os-sched-3", skillId: "os.scheduling", difficulty: 3,
      stem: "P1, P2 and P3 arrive at time 0 with bursts of 24, 3 and 3 ms, scheduled round robin with a 4 ms quantum. What is the average waiting time in ms, to two decimals?",
      explanation: "P1 runs 0-4, P2 4-7, P3 7-10, then P1 10-30. Waiting = finish - burst: P1 30 - 24 = 6, P2 7 - 3 = 4, P3 10 - 3 = 7. Average 17 / 3 = 5.67 ms.",
      hints: ["Draw the timeline; P2 and P3 finish within one quantum."],
      verify: `
from collections import deque
bursts = [24, 3, 3]
left = list(bursts)
queue = deque(range(len(bursts)))
t, finish = 0, [0] * len(bursts)
while queue:
    i = queue.popleft()
    run = min(4, left[i])
    t += run
    left[i] -= run
    if left[i]:
        queue.append(i)
    else:
        finish[i] = t
waits = [finish[i] - bursts[i] for i in range(len(bursts))]
print(f"{sum(waits) / len(waits):.2f}")`,
    },
    ["5.67", "17.00", "4.00", "7.33"], 0,
  ),
  concept(
    {
      id: "os-sched-4", skillId: "os.scheduling", difficulty: 1,
      stem: "A running process asks to read a file from disk. Which state does it move to while the read is in progress?",
      explanation: "It moves to blocked (waiting) until the I/O completes, then to ready. Ready means it could run but is waiting for the CPU.",
    },
    ["Blocked (waiting)", "Ready", "Running", "Terminated"], 0,
  ),

  // ---------------- OS: memory and deadlocks ----------------
  concept(
    {
      id: "os-mem-1", skillId: "os.memory", difficulty: 2,
      stem: `With 3 frames, initially empty, and FIFO page replacement, how many page faults does the reference string ${REFS.join(" ")} cause?`,
      explanation: "The first three references fill the frames (3 faults). FIFO then always evicts the page loaded earliest; only 0 (5th), 3 and 2 (last two) are hits, so 13 - 3 = 10 faults.",
      hints: ["Keep the frames as a queue; a hit doesn't change the order."],
      verify: pageFaults("fifo", REFS, 3),
    },
    ["10", "9", "8", "12"], 0,
  ),
  concept(
    {
      id: "os-mem-2", skillId: "os.memory", difficulty: 3,
      stem: `With 3 frames, initially empty, and LRU (least recently used) page replacement, how many page faults does the reference string ${REFS.join(" ")} cause?`,
      explanation: "LRU evicts the page unused for the longest time. Hits are 0 (5th), 0 (7th), and the final 3 and 2, so 13 - 4 = 9 faults.",
      hints: ["Unlike FIFO, a hit moves the page to most recently used."],
      verify: pageFaults("lru", REFS, 3),
    },
    ["9", "10", "8", "7"], 0,
  ),
  concept(
    {
      id: "os-mem-3", skillId: "os.memory", difficulty: 1,
      stem: "Which of these is NOT one of the four necessary conditions for a deadlock?",
      explanation: "The conditions are mutual exclusion, hold and wait, no preemption, and circular wait. Being able to preempt resources breaks a deadlock, so it isn't a condition for one.",
    },
    ["Resources can be preempted", "Mutual exclusion", "Hold and wait", "Circular wait"], 0,
  ),
  concept(
    {
      id: "os-mem-4", skillId: "os.memory", difficulty: 2,
      stem: "A system uses 32-bit logical addresses and 4 KB pages. How many bits of an address are the offset within the page?",
      explanation: "4 KB = 4096 = 2^12 bytes, so 12 bits address a byte within the page; the other 20 bits are the page number.",
      verify: `
import math
print(int(math.log2(4 * 1024)))`,
    },
    ["12", "20", "4", "32"], 0,
  ),

  // ---------------- Networks: layers and protocols ----------------
  concept(
    {
      id: "net-layers-1", skillId: "networks.layers", difficulty: 1,
      stem: "At which OSI layer does a router mainly work?",
      explanation: "Routers forward packets between networks by IP address: the network layer (3). Switches work at the data link layer (2) with MAC addresses.",
    },
    ["Network layer", "Data link layer", "Transport layer", "Physical layer"], 0,
  ),
  concept(
    {
      id: "net-layers-2", skillId: "networks.layers", difficulty: 1,
      stem: "Which protocol does a browser use to find the IP address of www.example.com?",
      explanation: "DNS turns names into IP addresses. DHCP hands out addresses to devices, ARP finds the MAC address for an IP on the local network, SMTP sends email.",
    },
    ["DNS", "DHCP", "ARP", "SMTP"], 0,
  ),
  concept(
    {
      id: "net-layers-3", skillId: "networks.layers", difficulty: 2,
      stem: "Which transport protocol suits a live video call, where a late packet is useless and should not hold up the rest?",
      explanation: "UDP sends without retransmission or ordering, so a lost frame is skipped instead of stalling the stream. TCP would wait to resend it.",
    },
    ["UDP", "TCP", "FTP", "ICMP"], 0,
  ),
  concept(
    {
      id: "net-layers-4", skillId: "networks.layers", difficulty: 1,
      stem: "How many segments are exchanged in TCP's handshake that opens a connection?",
      explanation: "Three: SYN, SYN-ACK, ACK (the three-way handshake). Closing usually takes four (FIN and ACK each way).",
    },
    ["3", "2", "4", "1"], 0,
  ),

  // ---------------- Networks: IP addressing ----------------
  concept(
    {
      id: "net-addr-1", skillId: "networks.addressing", difficulty: 2,
      stem: "How many usable host addresses are there in the network 192.168.10.0/26?",
      explanation: "A /26 leaves 32 - 26 = 6 host bits: 2^6 = 64 addresses, minus the network and broadcast addresses = 62.",
      hints: ["Count host bits, then subtract two."],
      verify: `
import ipaddress
print(ipaddress.ip_network("192.168.10.0/26").num_addresses - 2)`,
    },
    ["62", "64", "30", "126"], 0,
  ),
  concept(
    {
      id: "net-addr-2", skillId: "networks.addressing", difficulty: 2,
      stem: "What is the subnet mask of a /27 network?",
      explanation: "27 one-bits: 255.255.255 then 11100000 = 224 in the last byte.",
      verify: `
import ipaddress
print(ipaddress.ip_network("0.0.0.0/27").netmask)`,
    },
    ["255.255.255.224", "255.255.255.192", "255.255.255.240", "255.255.255.0"], 0,
  ),
  concept(
    {
      id: "net-addr-3", skillId: "networks.addressing", difficulty: 3,
      stem: "What is the broadcast address of the network 10.0.5.64/27?",
      explanation: "A /27 block holds 32 addresses: 10.0.5.64 to 10.0.5.95. The last one, 10.0.5.95, is the broadcast address.",
      verify: `
import ipaddress
print(ipaddress.ip_network("10.0.5.64/27").broadcast_address)`,
    },
    ["10.0.5.95", "10.0.5.127", "10.0.5.63", "10.0.5.255"], 0,
  ),
  concept(
    {
      id: "net-addr-4", skillId: "networks.addressing", difficulty: 2,
      stem: "Which of these is a private IPv4 address?",
      explanation: "The private ranges are 10.0.0.0/8, 172.16.0.0/12 (172.16 to 172.31) and 192.168.0.0/16. 172.32.4.1 and 192.169.1.1 are just outside them.",
      verify: `
import ipaddress
print(next(a for a in ["172.16.4.1", "172.32.4.1", "8.8.8.8", "192.169.1.1"] if ipaddress.ip_address(a).is_private))`,
    },
    ["172.16.4.1", "172.32.4.1", "8.8.8.8", "192.169.1.1"], 0,
  ),
];
