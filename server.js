const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(__dirname));

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'mercado_local',
  password: '123456789',
  port: 5432,
});

// ── REGISTRO ──────────────────────────────────────────────────
app.post('/api/registro', async (req, res) => {
  const { nombre, telefono, email, password, rol } = req.body;
  try {
    await pool.query(
      `INSERT INTO usuarios (nombre, telefono, correo, password, rol) VALUES ($1, $2, $3, $4, $5)`,
      [nombre, telefono, email, password, rol]
    );
    res.status(200).json({ mensaje: 'Registro exitoso' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al registrar: ' + err.message });
  }
});

// ── LOGIN ─────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query(
      `SELECT * FROM usuarios WHERE correo = $1 AND password = $2`,
      [email, password]
    );
    if (result.rows.length > 0) {
      const u = result.rows[0];
      res.status(200).json({
        mensaje: 'Login exitoso',
        id: u.id_usuario || u.id,
        nombre: u.nombre,
        rol: u.rol
      });
    } else {
      res.status(401).json({ mensaje: 'Usuario o contraseña incorrectos' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error en servidor: ' + err.message });
  }
});

// ── PRODUCTOS — obtener todos ──────────────────────────────────
app.get('/api/productos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM public.productos ORDER BY id_producto ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PRODUCTOS — agregar ───────────────────────────────────────
app.post('/api/productos', async (req, res) => {
  const { nombre, categoria, precio, stock } = req.body;
  try {
    let id_comercio;
    const comRes = await pool.query(`SELECT id_comercio FROM public.comercios LIMIT 1`);
    if (comRes.rows.length > 0) {
      id_comercio = comRes.rows[0].id_comercio;
    } else {
      // Buscar propietario por id_usuario o id
      let usrRes = await pool.query(`SELECT id_usuario FROM public.usuarios WHERE rol = 'comerciante' LIMIT 1`).catch(() => ({ rows: [] }));
      if (!usrRes.rows.length) {
        usrRes = await pool.query(`SELECT id FROM public.usuarios WHERE rol = 'comerciante' LIMIT 1`).catch(() => ({ rows: [] }));
      }
      if (!usrRes.rows.length) return res.status(400).json({ error: 'No hay comerciantes registrados.' });
      const id_prop = usrRes.rows[0].id_usuario || usrRes.rows[0].id;
      const newCom = await pool.query(
        `INSERT INTO public.comercios (nombre, propietario, tipo) VALUES ($1, $2, $3) RETURNING id_comercio`,
        ['Mi Comercio', id_prop, 'General']
      );
      id_comercio = newCom.rows[0].id_comercio;
    }
    await pool.query(
      `INSERT INTO public.productos (id_comercio, nombre, categoria, precio, stock) VALUES ($1, $2, $3, $4, $5)`,
      [id_comercio, nombre, categoria, precio, stock]
    );
    res.status(201).json({ mensaje: 'Producto guardado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── PRODUCTOS — eliminar ──────────────────────────────────────
app.delete('/api/productos/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM public.detalle_pedido WHERE id_producto = $1', [req.params.id]);
    await pool.query('DELETE FROM public.productos WHERE id_producto = $1', [req.params.id]);
    res.json({ mensaje: 'Producto eliminado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PEDIDOS — crear ───────────────────────────────────────────
app.post('/api/pedidos', async (req, res) => {
  const { id_cliente, items } = req.body;
  if (!items || items.length === 0) return res.status(400).json({ error: 'El carrito está vacío' });
  try {
    const total = items.reduce((sum, i) => sum + i.precio * i.cantidad, 0);
    const prodRes = await pool.query(
      'SELECT id_comercio FROM public.productos WHERE id_producto = $1', [items[0].id_producto]
    );
    if (!prodRes.rows.length) return res.status(400).json({ error: 'Producto no encontrado' });
    const id_comercio = prodRes.rows[0].id_comercio;

    const pedidoRes = await pool.query(
      `INSERT INTO public.pedidos (id_cliente, id_comercio, total, estado)
       VALUES ($1, $2, $3, 'pendiente') RETURNING id_pedido`,
      [id_cliente, id_comercio, total]
    );
    const id_pedido = pedidoRes.rows[0].id_pedido;

    for (const item of items) {
      await pool.query(
        `INSERT INTO public.detalle_pedido (id_pedido, id_producto, cantidad, subtotal) VALUES ($1, $2, $3, $4)`,
        [id_pedido, item.id_producto, item.cantidad, item.precio * item.cantidad]
      );
    }
    res.status(201).json({ mensaje: 'Pedido enviado.', id_pedido });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── PEDIDOS — pendientes (proveedor) ──────────────────────────
app.get('/api/pedidos/pendientes', async (req, res) => {
  for (const col of ['u.id_usuario', 'u.id']) {
    try {
      const result = await pool.query(`
        SELECT p.id_pedido, p.fecha, p.total, p.estado,
               u.nombre AS cliente, u.telefono
        FROM public.pedidos p
        JOIN public.usuarios u ON p.id_cliente = ${col}
        WHERE p.estado = 'pendiente'
        ORDER BY p.fecha DESC
      `);
      return res.json(result.rows);
    } catch {
      if (col === 'u.id') return res.status(500).json({ error: 'No se pudo leer pedidos' });
    }
  }
});

// ── PEDIDOS — del cliente ─────────────────────────────────────
app.get('/api/pedidos/cliente/:id', async (req, res) => {
  for (const sel of ['razon_rechazo', 'NULL AS razon_rechazo']) {
    try {
      const result = await pool.query(
        `SELECT id_pedido, fecha, total, estado, ${sel} FROM public.pedidos WHERE id_cliente = $1 ORDER BY fecha DESC`,
        [req.params.id]
      );
      return res.json(result.rows);
    } catch {
      if (sel === 'NULL AS razon_rechazo') return res.status(500).json({ error: 'No se pudo leer pedidos' });
    }
  }
});

// ── PEDIDOS — detalle ─────────────────────────────────────────
app.get('/api/pedidos/:id/detalle', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT dp.cantidad, dp.subtotal, pr.nombre AS producto
      FROM public.detalle_pedido dp
      JOIN public.productos pr ON dp.id_producto = pr.id_producto
      WHERE dp.id_pedido = $1
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PEDIDOS — confirmar ───────────────────────────────────────
app.put('/api/pedidos/:id/aceptar', async (req, res) => {
  try {
    await pool.query(
      `UPDATE public.pedidos SET estado = 'confirmado' WHERE id_pedido = $1`, [req.params.id]
    );
    res.json({ mensaje: 'Pedido confirmado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PEDIDOS — rechazar ────────────────────────────────────────
app.put('/api/pedidos/:id/rechazar', async (req, res) => {
  const { razon } = req.body;
  try {
    await pool.query(
      `UPDATE public.pedidos SET estado = 'cancelado', razon_rechazo = $1 WHERE id_pedido = $2`,
      [razon || 'Sin especificar', req.params.id]
    );
    res.json({ mensaje: 'Pedido rechazado' });
  } catch {
    try {
      await pool.query(
        `UPDATE public.pedidos SET estado = 'cancelado' WHERE id_pedido = $1`, [req.params.id]
      );
      res.json({ mensaje: 'Pedido rechazado' });
    } catch (err2) {
      res.status(500).json({ error: err2.message });
    }
  }
});

// ── PEDIDOS — pagar ───────────────────────────────────────────
app.put('/api/pedidos/:id/pagar', async (req, res) => {
  try {
    await pool.query(
      `UPDATE public.pedidos SET estado = 'en_proceso' WHERE id_pedido = $1`, [req.params.id]
    );
    res.json({ mensaje: 'Pago registrado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GANANCIAS ─────────────────────────────────────────────────
app.get('/api/ganancias', async (req, res) => {
  try {
    const total = await pool.query(
      `SELECT COALESCE(SUM(total), 0) AS total FROM public.pedidos WHERE estado IN ('en_proceso', 'entregado')`
    );
    let pedidos;
    try {
      pedidos = await pool.query(`
        SELECT p.id_pedido, p.fecha, p.total, u.nombre AS cliente
        FROM public.pedidos p
        JOIN public.usuarios u ON p.id_cliente = u.id_usuario
        WHERE p.estado IN ('en_proceso', 'entregado')
        ORDER BY p.fecha DESC
      `);
    } catch {
      pedidos = await pool.query(`
        SELECT p.id_pedido, p.fecha, p.total, u.nombre AS cliente
        FROM public.pedidos p
        JOIN public.usuarios u ON p.id_cliente = u.id
        WHERE p.estado IN ('en_proceso', 'entregado')
        ORDER BY p.fecha DESC
      `);
    }
    res.json({ total: total.rows[0].total, pedidos: pedidos.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DIAGNÓSTICO ───────────────────────────────────────────────
app.get('/api/diagnostico', async (req, res) => {
  try {
    const tablas = {};
    for (const t of ['usuarios', 'pedidos', 'productos', 'comercios', 'detalle_pedido']) {
      const r = await pool.query(
        `SELECT column_name, data_type FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [t]
      );
      tablas[t] = r.rows;
    }
    const estados = await pool.query(`SELECT estado, COUNT(*) FROM public.pedidos GROUP BY estado`).catch(() => ({ rows: [] }));
    res.json({ tablas, pedidos_por_estado: estados.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, '0.0.0.0', () => {
  console.log('Servidor activo en http://192.168.137.93:3000');
  pool.query('SELECT 1').then(() => console.log('BD conectada OK')).catch(e => console.error('Error BD:', e.message));
});