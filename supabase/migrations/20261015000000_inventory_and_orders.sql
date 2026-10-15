create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null check (sku = upper(btrim(sku)) and char_length(sku) between 1 and 40),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 1000),
  price numeric(12, 2) not null check (price >= 0),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  minimum_stock integer not null default 0 check (minimum_stock >= 0),
  is_active boolean not null default true,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index products_sku_unique on public.products (lower(sku));
create index products_active_name_idx on public.products (is_active, name);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id),
  total numeric(12, 2) not null default 0 check (total >= 0),
  created_at timestamptz not null default now()
);

create index orders_client_created_idx on public.orders (client_id, created_at desc);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  product_sku text not null,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  unique (order_id, product_id)
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  order_id uuid references public.orders (id) on delete restrict,
  movement_type text not null check (movement_type in ('entry', 'exit', 'sale')),
  quantity integer not null check (quantity > 0),
  reason text not null check (char_length(btrim(reason)) between 1 and 240),
  performed_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index inventory_movements_product_created_idx
  on public.inventory_movements (product_id, created_at desc);

alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.inventory_movements enable row level security;

revoke all on table public.products, public.orders, public.order_items,
  public.inventory_movements from anon, authenticated;

grant select on table public.products, public.orders, public.order_items,
  public.inventory_movements to authenticated;
grant update (sku, name, description, price, minimum_stock, is_active)
  on public.products to authenticated;

create policy "Active products are visible to customers and administrators"
on public.products
for select
to authenticated
using (
  (is_active and (select public.is_active_user()))
  or (select public.is_admin())
);

create policy "Administrators update product details"
on public.products
for update
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy "Customers see their own orders and administrators see all orders"
on public.orders
for select
to authenticated
using (
  (client_id = (select auth.uid()) and (select public.is_active_user()))
  or (select public.is_admin())
);

create policy "Customers see their own order items and administrators see all items"
on public.order_items
for select
to authenticated
using (
  (select public.is_admin())
  or exists (
    select 1
    from public.orders
    where orders.id = order_items.order_id
      and orders.client_id = (select auth.uid())
  )
);

create policy "Only administrators can view inventory movements"
on public.inventory_movements
for select
to authenticated
using ((select public.is_admin()));

create or replace function public.set_product_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_products_updated_at
before update on public.products
for each row execute function public.set_product_updated_at();

create or replace function public.create_product(
  p_sku text,
  p_name text,
  p_description text,
  p_price numeric,
  p_minimum_stock integer,
  p_initial_stock integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
begin
  if not (select public.is_admin()) then
    raise exception 'Esta acción requiere una cuenta de administrador activa.';
  end if;

  if p_initial_stock is null or p_initial_stock < 0 then
    raise exception 'La existencia inicial no puede ser negativa.';
  end if;

  insert into public.products (
    sku, name, description, price, minimum_stock, stock_quantity, created_by
  )
  values (
    upper(btrim(p_sku)),
    btrim(p_name),
    coalesce(p_description, ''),
    p_price,
    p_minimum_stock,
    p_initial_stock,
    (select auth.uid())
  )
  returning id into v_product_id;

  if p_initial_stock > 0 then
    insert into public.inventory_movements (
      product_id, movement_type, quantity, reason, performed_by
    )
    values (
      v_product_id, 'entry', p_initial_stock, 'Existencia inicial', (select auth.uid())
    );
  end if;

  return v_product_id;
end;
$$;

create or replace function public.adjust_inventory(
  p_product_id uuid,
  p_movement_type text,
  p_quantity integer,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stock integer;
begin
  if not (select public.is_admin()) then
    raise exception 'Esta acción requiere una cuenta de administrador activa.';
  end if;

  if p_movement_type not in ('entry', 'exit') then
    raise exception 'El tipo de movimiento debe ser entrada o salida.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'La cantidad debe ser mayor que cero.';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 240 then
    raise exception 'Escribe un motivo de hasta 240 caracteres.';
  end if;

  select stock_quantity
    into v_stock
    from public.products
    where id = p_product_id
    for update;

  if not found then
    raise exception 'No se encontró el producto seleccionado.';
  end if;

  if p_movement_type = 'exit' and v_stock < p_quantity then
    raise exception 'No hay existencias suficientes para registrar esa salida.';
  end if;

  update public.products
    set stock_quantity = case
      when p_movement_type = 'entry' then stock_quantity + p_quantity
      else stock_quantity - p_quantity
    end
    where id = p_product_id
    returning stock_quantity into v_stock;

  insert into public.inventory_movements (
    product_id, movement_type, quantity, reason, performed_by
  )
  values (
    p_product_id, p_movement_type, p_quantity, btrim(p_reason), (select auth.uid())
  );

  return v_stock;
end;
$$;

create or replace function public.place_order(p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_order_id uuid;
  v_item record;
  v_product record;
  v_total numeric(12, 2) := 0;
begin
  if v_user_id is null or not exists (
    select 1
    from public.profiles
    where id = v_user_id
      and role = 'client'
      and is_active
  ) then
    raise exception 'Se requiere una cuenta de cliente activa para comprar.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'El pedido debe incluir entre 1 y 50 productos.';
  end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 50 then
    raise exception 'El pedido debe incluir entre 1 y 50 productos.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as entry(value)
    where jsonb_typeof(entry.value) <> 'object'
      or coalesce(entry.value->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(entry.value->>'quantity', '') !~ '^[1-9][0-9]*$'
  ) then
    raise exception 'El pedido contiene productos o cantidades no válidos.';
  end if;

  insert into public.orders (client_id)
  values (v_user_id)
  returning id into v_order_id;

  for v_item in
    select (entry.value->>'product_id')::uuid as product_id,
      sum((entry.value->>'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) as entry(value)
    group by (entry.value->>'product_id')::uuid
    order by (entry.value->>'product_id')::uuid
  loop
    select id, sku, name, price, stock_quantity
      into v_product
      from public.products
      where id = v_item.product_id and is_active
      for update;

    if not found then
      raise exception 'Uno de los productos del pedido ya no está disponible.';
    end if;
    if v_product.stock_quantity < v_item.quantity then
      raise exception 'Existencias insuficientes para el producto "%".', v_product.name;
    end if;

    update public.products
      set stock_quantity = stock_quantity - v_item.quantity
      where id = v_product.id;

    insert into public.order_items (
      order_id, product_id, product_sku, product_name, quantity, unit_price
    )
    values (
      v_order_id,
      v_product.id,
      v_product.sku,
      v_product.name,
      v_item.quantity,
      v_product.price
    );

    insert into public.inventory_movements (
      product_id, order_id, movement_type, quantity, reason, performed_by
    )
    values (
      v_product.id,
      v_order_id,
      'sale',
      v_item.quantity,
      'Venta - pedido ' || v_order_id::text,
      v_user_id
    );

    v_total := v_total + (v_product.price * v_item.quantity);
  end loop;

  update public.orders
    set total = v_total
    where id = v_order_id;

  return v_order_id;
end;
$$;

revoke all on function public.set_product_updated_at() from public, anon, authenticated;
revoke all on function public.create_product(text, text, text, numeric, integer, integer)
  from public, anon, authenticated;
revoke all on function public.adjust_inventory(uuid, text, integer, text)
  from public, anon, authenticated;
revoke all on function public.place_order(jsonb) from public, anon, authenticated;

grant execute on function public.create_product(text, text, text, numeric, integer, integer)
  to authenticated;
grant execute on function public.adjust_inventory(uuid, text, integer, text)
  to authenticated;
grant execute on function public.place_order(jsonb) to authenticated;

comment on table public.products is
  'Catalog products. Stock changes are permitted only through audited database functions.';
comment on table public.inventory_movements is
  'Immutable audit trail for initial stock, manual adjustments, and customer sales.';
