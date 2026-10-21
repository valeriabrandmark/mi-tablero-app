-- migración `costo_manual_c03041` · 21/10/2026
--
-- EL COSTO DE UN ARTICULO, CARGADO A MANO. EXCEPCIONAL.
--
-- `bronze.costos_historicos` la llena el orquestador con la lista del
-- proveedor. C03041 (CK ONE NIGHT ESSENCE PARFUM 200ML, COTY ARGENTINA SA) no
-- estaba en ninguna: cero filas, en ningún mes.
--
-- Sin costo, Compras lo muestra en $0 y el sugerido da 0 --la regla es
-- explícita: costo 0, no se pide--, así que el artículo se ve pero no se
-- puede comprar. ANA pidió cargarle el costo teórico a mano para destrabarlo.
--
-- ---------------------------------------------------------------------------
-- POR QUE ESTO NO SE PISA SOLO, Y POR QUE ESO ESTA BIEN
--
-- El orquestador no reescribe la tabla: cada corrida AGREGA un tramo nuevo con
-- la lista entera y su `vigente_desde`. Por eso esta fila sobrevive a las
-- próximas corridas.
--
-- Y por eso también se corrige sola. Las consultas toman, POR SKU, el tramo
-- más nuevo que ya empezó (ver lib/sql-costos.ts): el día que la lista de COTY
-- traiga C03041, ese tramo es más nuevo que éste y gana. Esta fila deja de
-- usarse sin que haya que acordarse de borrarla.
--
-- ---------------------------------------------------------------------------
-- POR QUE TAMBIEN SE ESCRIBE costo_real, Y QUE SUPONE
--
-- Son dos columnas distintas. `costo_teorico` es el precio de lista --es el
-- número que pidió ANA-- y `costo_real` es lo que se paga después del sell in:
-- en toda la tabla, `costo_real = costo_teorico * (1 - oferta_pct / 100)`
-- (verificado contra las filas de octubre).
--
-- Compras valoriza y decide el sugerido con `costo_real`, no con el teórico.
-- Si esta fila dejara `costo_real` vacío, el artículo seguiría en $0 y en
-- sugerido 0: el pedido no se habría cumplido.
--
-- Así que va `oferta_pct = 0` y `costo_real = costo_teorico`. LO QUE SUPONE ES
-- QUE NO HAY OFERTA DE COTY PARA ESTE ARTICULO. Es la suposición conservadora
-- --sin oferta se paga la lista, así que el costo no queda subestimado-- pero
-- es una suposición, y es la única de esta migración.
--
-- ---------------------------------------------------------------------------
-- LA FECHA ES HOY, NO EL 1 DEL MES
--
-- `vigente_desde` es desde cuándo rige. Hoy es cuando se supo. Ponerle el 1
-- haría que el costo recostee hacia atrás ventas de octubre hechas sin él; en
-- este caso no cambia nada --C03041 no vendió nunca-- pero la regla no se
-- cambia por un caso que no la necesita.
insert into bronze.costos_historicos
  (sku, mes_comercial, vigente_desde, costo_teorico, costo_real,
   oferta_pct, desc_propio_pct)
select 'C03041', '2026-10', date '2026-10-21', 91953, 91953, 0, 0
where not exists (
  -- Que correrla dos veces no cargue el costo dos veces.
  select 1 from bronze.costos_historicos
  where sku = 'C03041' and mes_comercial = '2026-10'
    and vigente_desde = date '2026-10-21'
);
