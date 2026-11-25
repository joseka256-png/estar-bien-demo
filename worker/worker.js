// Asistente virtual de Centro Médico Estar Bien — Cloudflare Worker (demo)
// Modelo: Workers AI de Cloudflare (sin llave externa). Hecho por ISCR Tech.

const SYSTEM_PROMPT = `Eres el asistente virtual del Centro Médico Estar Bien, en Cartago, Costa Rica (100 m oeste del Condominio Villas Durango). Respondes en español de Costa Rica, con trato de "usted", cálido y breve (máximo 4 líneas), sin markdown ni asteriscos.

REGLAS OBLIGATORIAS:
1. NUNCA das consejo médico: no diagnosticas, no recomiendas medicamentos ni dosis, no interpretas síntomas ni resultados. Si el paciente describe síntomas o pregunta qué tomar, dile con amabilidad que eso lo debe valorar un especialista de salud y ofrécele una cita con la especialidad que atiende ese tipo de consulta, sin opinar del caso. Si menciona algo grave (dolor fuerte en el pecho, dificultad para respirar, sangrado abundante, desmayo), indícale llamar al 9-1-1 o ir a emergencias de inmediato.
2. PRECIOS: solo das un precio cuando el paciente tiene claro el servicio o la especialidad. Si no está claro, primero pregunta o lo orientas sin cotizar.
3. DATOS: antes de pasar a la recepción, pide con permiso: nombre completo, teléfono, especialidad y motivo general de la consulta (sin detalles clínicos). Explica que los datos solo se usan para coordinar su cita.
4. HORARIOS: usa el horario de abajo.
5. ESPECIALIDADES: explica en lenguaje sencillo qué atiende cada una.
6. AGENDA: NO agendas ni confirmas citas en el chat. Cuando el paciente quiera una cita y ya tengas nombre, teléfono, especialidad y motivo, dile que toque el botón verde para confirmar con la recepción por WhatsApp, y al final de tu respuesta agrega exactamente este bloque (el sistema lo convierte en el botón; no lo menciones):
<<LEAD>>{"nombre":"...","telefono":"...","especialidad":"...","motivo":"..."}<<FIN>>
No inventes datos que no estén aquí; si no sabes algo, ofrece pasarlo con la recepción por WhatsApp.

INFORMACIÓN:
Horario: lunes a sábado de 7:00 a.m. a 9:00 p.m.; domingo cerrado.
Especialidades y precio de consulta (precios de ejemplo para la demostración):
- Medicina general: chequeos, enfermedades comunes, referencias. ₡25.000
- Cardiología: corazón y presión arterial. ₡45.000
- Gastroenterología: estómago, intestinos, hígado y digestión. ₡45.000
- Ginecología: salud de la mujer, controles y embarazo. ₡40.000
- Cirugía general: valoración de hernias, vesícula y otras cirugías. ₡45.000
- Cirugía bariátrica: valoración para cirugía de obesidad. ₡50.000`;

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MAX_TURNS = 16;
const MAX_CHARS = 800;
const LEAD_RE = /<<LEAD>>([\s\S]*?)<<FIN>>/;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/salud") return json({ ok: true, modelo: MODEL }, 200, cors);
    if (request.method !== "POST" || url.pathname !== "/chat") return json({ error: "No encontrado" }, 404, cors);
    if (!cors["Access-Control-Allow-Origin"]) return json({ error: "Origen no permitido" }, 403, cors);

    let body;
    try { body = await request.json(); } catch { return json({ error: "JSON inválido" }, 400, cors); }
    const messages = sanitize(body && body.messages);
    if (!messages) return json({ error: "Mensajes inválidos" }, 400, cors);

    let raw;
    try {
      const out = await env.AI.run(MODEL, {
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
        max_tokens: 500,
        temperature: 0.4,
      });
      raw = String((out && out.response) || "").trim();
      if (!raw) throw new Error("respuesta vacía");
    } catch (e) {
      console.error("Error del modelo:", e.message);
      return json({ reply: "En este momento no puedo responder. Puede escribirnos por WhatsApp y la recepción le atiende.", lead: null, error: true, whatsapp: waLink(env, "Hola, quiero información del Centro Médico Estar Bien.") }, 200, cors);
    }

    const reply = raw.replace(LEAD_RE, "").trim();
    let lead = null;
    const m = raw.match(LEAD_RE);
    if (m) {
      try {
        const d = JSON.parse(m[1]);
        const text = [
          "Hola, quiero agendar una cita en Centro Médico Estar Bien.",
          d.nombre ? `Nombre: ${d.nombre}` : "",
          d.telefono ? `Teléfono: ${d.telefono}` : "",
          d.especialidad ? `Especialidad: ${d.especialidad}` : "",
          d.motivo ? `Motivo: ${d.motivo}` : "",
        ].filter(Boolean).join("\n");
        lead = { ...d, whatsapp: waLink(env, text) };
      } catch (e) { console.warn("Lead mal formado"); }
    }
    return json({ reply, lead }, 200, cors);
  },
};

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || "https://joseka256-png.github.io").split(",").map(s => s.trim()).filter(Boolean);
  const h = { "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", "Vary": "Origin" };
  if (allowed.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
}

function sanitize(list) {
  if (!Array.isArray(list) || !list.length) return null;
  const out = list.slice(-MAX_TURNS)
    .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map(m => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
  while (out.length && out[0].role !== "user") out.shift();
  if (!out.length || out[out.length - 1].role !== "user") return null;
  return out;
}

function waLink(env, text) {
  return `https://wa.me/${env.WHATSAPP_NUMBER || "50686901930"}?text=${encodeURIComponent(text)}`;
}
