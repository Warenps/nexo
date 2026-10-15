import { useEffect, useState, type FormEvent } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { supabase } from '../lib/supabase'

type Product = {
  id: string
  sku: string
  name: string
  description: string
  price: number
  stock_quantity: number
  minimum_stock: number
  is_active: boolean
}

type OrderItem = {
  product_name: string
  quantity: number
  unit_price: number
}

type PurchaseOrder = {
  id: string
  total: number
  created_at: string
  order_items: OrderItem[]
}

type InventoryMovement = 'entry' | 'exit'
type AdminInventorySection = 'overview' | 'products' | 'stock' | 'movements'
type ClientStoreSection = 'catalog' | 'cart' | 'orders'
type CartItem = { product: Product; quantity: number }
type MovementRow = {
  id: string
  movement_type: 'entry' | 'exit' | 'sale'
  quantity: number
  reason: string
  created_at: string
  products: { name: string; sku: string }[]
}

const currency = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
})

export function AdminInventory({
  section,
}: {
  section: AdminInventorySection
}) {
  const [products, setProducts] = useState<Product[]>([])
  const [movements, setMovements] = useState<MovementRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [notice, setNotice] = useState('')
  const [editingProductId, setEditingProductId] = useState('')
  const [selectedProductId, setSelectedProductId] = useState('')
  const [sku, setSku] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [minimumStock, setMinimumStock] = useState('0')
  const [initialStock, setInitialStock] = useState('0')
  const [movementType, setMovementType] = useState<InventoryMovement>('entry')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')

  async function refreshProducts() {
    if (!supabase) throw new Error('Supabase no está configurado.')

    const [productResult, movementResult] = await Promise.all([
      supabase
        .from('products')
        .select(
          'id, sku, name, description, price, stock_quantity, minimum_stock, is_active',
        )
        .order('name'),
      supabase
        .from('inventory_movements')
        .select('id, movement_type, quantity, reason, created_at, products(name, sku)')
        .order('created_at', { ascending: false })
        .limit(20),
    ])

    if (productResult.error) throw productResult.error
    if (movementResult.error) throw movementResult.error
    setProducts((productResult.data ?? []) as Product[])
    setMovements((movementResult.data ?? []) as MovementRow[])
    setSelectedProductId((current) =>
      (productResult.data ?? []).some((product) => product.id === current)
        ? current
        : (productResult.data ?? [])[0]?.id ?? '',
    )
  }

  useEffect(() => {
    let isCurrent = true

    async function load() {
      try {
        if (!supabase) throw new Error('Supabase no está configurado.')
        const [productResult, movementResult] = await Promise.all([
          supabase
            .from('products')
            .select(
              'id, sku, name, description, price, stock_quantity, minimum_stock, is_active',
            )
            .order('name'),
          supabase
            .from('inventory_movements')
            .select(
              'id, movement_type, quantity, reason, created_at, products(name, sku)',
            )
            .order('created_at', { ascending: false })
            .limit(20),
        ])

        if (productResult.error) throw productResult.error
        if (movementResult.error) throw movementResult.error
        if (isCurrent) {
          setProducts((productResult.data ?? []) as Product[])
          setMovements((movementResult.data ?? []) as MovementRow[])
          setSelectedProductId((productResult.data ?? [])[0]?.id ?? '')
        }
      } catch (error) {
        if (isCurrent) setErrorMessage(errorText(error))
      } finally {
        if (isCurrent) setLoading(false)
      }
    }

    void load()
    return () => {
      isCurrent = false
    }
  }, [])

  function startEditing(product: Product) {
    setEditingProductId(product.id)
    setSku(product.sku)
    setName(product.name)
    setDescription(product.description)
    setPrice(String(product.price))
    setMinimumStock(String(product.minimum_stock))
    setInitialStock('0')
    setErrorMessage('')
    setNotice('')
  }

  function clearProductForm() {
    setEditingProductId('')
    setSku('')
    setName('')
    setDescription('')
    setPrice('')
    setMinimumStock('0')
    setInitialStock('0')
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage('')
    setNotice('')

    const parsedPrice = Number(price)
    const parsedMinimumStock = Number(minimumStock)
    const parsedInitialStock = Number(initialStock)
    if (
      !sku.trim() ||
      !name.trim() ||
      !Number.isFinite(parsedPrice) ||
      parsedPrice < 0 ||
      !Number.isInteger(parsedMinimumStock) ||
      parsedMinimumStock < 0 ||
      !Number.isInteger(parsedInitialStock) ||
      parsedInitialStock < 0
    ) {
      setErrorMessage('Revisa los datos y las cantidades del producto.')
      return
    }
    if (!supabase) {
      setErrorMessage('Supabase no está configurado.')
      return
    }

    setSaving(true)
    try {
      const successMessage = editingProductId
        ? 'Los datos del producto se actualizaron.'
        : 'El producto se agregó al inventario.'
      if (editingProductId) {
        const { error } = await supabase
          .from('products')
          .update({
            sku: sku.trim().toUpperCase(),
            name: name.trim(),
            description: description.trim(),
            price: parsedPrice,
            minimum_stock: parsedMinimumStock,
          })
          .eq('id', editingProductId)
        if (error) throw error
      } else {
        const { error } = await supabase.rpc('create_product', {
          p_sku: sku.trim(),
          p_name: name.trim(),
          p_description: description.trim(),
          p_price: parsedPrice,
          p_minimum_stock: parsedMinimumStock,
          p_initial_stock: parsedInitialStock,
        })

        if (error) throw error
      }

      clearProductForm()
      setNotice(successMessage)
      try {
        await refreshProducts()
      } catch (error) {
        setErrorMessage(
          `El producto se guardó, pero no se pudo actualizar la lista: ${errorText(error)}`,
        )
      }
    } catch (error) {
      setErrorMessage(errorText(error))
    } finally {
      setSaving(false)
    }
  }

  async function toggleProduct(product: Product) {
    if (!supabase) return
    if (
      product.is_active &&
      !window.confirm(
        `¿Eliminar ${product.name} del catálogo? Se conservará el historial y podrás reactivarlo después.`,
      )
    ) {
      return
    }
    setErrorMessage('')
    setNotice('')
    setSaving(true)
    try {
      const { error } = await supabase
        .from('products')
        .update({ is_active: !product.is_active })
        .eq('id', product.id)

      if (error) throw error
      const successMessage = product.is_active
        ? 'El producto se eliminó del catálogo; su historial se conservó.'
        : 'El producto volvió a estar disponible en el catálogo.'
      setNotice(successMessage)
      try {
        await refreshProducts()
      } catch (error) {
        setErrorMessage(
          `El cambio se guardó, pero no se pudo actualizar la lista: ${errorText(error)}`,
        )
      }
    } catch (error) {
      setErrorMessage(errorText(error))
    } finally {
      setSaving(false)
    }
  }

  async function registerMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage('')
    setNotice('')

    const parsedQuantity = Number(quantity)
    if (!selectedProductId || !Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
      setErrorMessage('Selecciona un producto e indica una cantidad mayor que cero.')
      return
    }
    if (!reason.trim()) {
      setErrorMessage('Escribe el motivo del movimiento.')
      return
    }
    if (!supabase) {
      setErrorMessage('Supabase no está configurado.')
      return
    }

    setSaving(true)
    try {
      const { error } = await supabase.rpc('adjust_inventory', {
        p_product_id: selectedProductId,
        p_movement_type: movementType,
        p_quantity: parsedQuantity,
        p_reason: reason.trim(),
      })
      if (error) throw error

      setQuantity('')
      setReason('')
      setNotice(
        movementType === 'entry'
          ? 'La entrada quedó registrada y el stock se actualizó.'
          : 'La salida quedó registrada y el stock se actualizó.',
      )
      try {
        await refreshProducts()
      } catch (error) {
        setErrorMessage(
          `El movimiento se registró, pero no se pudo actualizar la lista: ${errorText(error)}`,
        )
      }
    } catch (error) {
      setErrorMessage(errorText(error))
    } finally {
      setSaving(false)
    }
  }

  const lowStockCount = products.filter(
    (product) => product.is_active && product.stock_quantity <= product.minimum_stock,
  ).length

  return (
    <section className="inventory-section" aria-labelledby="inventory-title">
      <div className="inventory-heading">
        <div>
          <p className="eyebrow">CONTROL DE EXISTENCIAS</p>
          <h3 id="inventory-title">Inventario</h3>
        </div>
        <div className="inventory-summary">
          <span>{products.length} productos</span>
          <span className={lowStockCount ? 'stock-warning' : ''}>
            {lowStockCount} con stock bajo
          </span>
        </div>
      </div>

      {errorMessage && <InventoryFeedback kind="error">{errorMessage}</InventoryFeedback>}
      {notice && <InventoryFeedback kind="success">{notice}</InventoryFeedback>}

      {section === 'overview' && (
        <div className="inventory-overview">
          <article>
            <span>Productos</span>
            <strong>{products.length}</strong>
          </article>
          <article>
            <span>Activos</span>
            <strong>{products.filter((product) => product.is_active).length}</strong>
          </article>
          <article className={lowStockCount ? 'overview-warning' : ''}>
            <span>Stock bajo</span>
            <strong>{lowStockCount}</strong>
          </article>
        </div>
      )}

      {section === 'products' && <div className="inventory-layout">
        <form className="inventory-form" onSubmit={saveProduct}>
          <h4>{editingProductId ? 'Editar producto' : 'Agregar producto'}</h4>
          <label className="field">
            <span>SKU</span>
            <input
              value={sku}
              onChange={(event) => setSku(event.target.value)}
              maxLength={40}
              required
              disabled={saving}
            />
          </label>
          <label className="field">
            <span>Nombre</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              required
              disabled={saving}
            />
          </label>
          <label className="field">
            <span>Descripción</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={1000}
              rows={3}
              disabled={saving}
            />
          </label>
          <div className="inventory-fields-row">
            <label className="field">
              <span>Precio (MXN)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                required
                disabled={saving}
              />
            </label>
            <label className="field">
              <span>Stock mínimo</span>
              <input
                type="number"
                min="0"
                step="1"
                value={minimumStock}
                onChange={(event) => setMinimumStock(event.target.value)}
                required
                disabled={saving}
              />
            </label>
          </div>
          {!editingProductId && (
            <label className="field">
              <span>Existencia inicial</span>
              <input
                type="number"
                min="0"
                step="1"
                value={initialStock}
                onChange={(event) => setInitialStock(event.target.value)}
                required
                disabled={saving}
              />
            </label>
          )}
          <div className="inventory-form-actions">
            <button className="primary-button" type="submit" disabled={saving}>
              {saving
                ? 'Guardando…'
                : editingProductId
                  ? 'Guardar cambios'
                  : 'Agregar producto'}
            </button>
            {editingProductId && (
              <button
                className="secondary-button"
                type="button"
                onClick={clearProductForm}
                disabled={saving}
              >
                Cancelar
              </button>
            )}
          </div>
        </form>

        <div className="inventory-products">
          <h4>Productos</h4>
          {loading ? (
            <p className="table-message">Cargando inventario…</p>
          ) : products.length === 0 ? (
            <p className="table-message">Aún no hay productos registrados.</p>
          ) : (
            <div className="product-list">
              {products.map((product) => (
                <article className="product-row" key={product.id}>
                  <div className="product-info">
                    <div className="product-title-line">
                      <strong>{product.name}</strong>
                      <span
                        className={`product-status ${product.is_active ? 'is-active' : 'is-inactive'}`}
                      >
                        {product.is_active ? 'Activo' : 'Inactivo'}
                      </span>
                    </div>
                    <span>SKU {product.sku} · {currency.format(product.price)}</span>
                    <span
                      className={
                        product.stock_quantity <= product.minimum_stock
                          ? 'stock-warning'
                          : ''
                      }
                    >
                      Stock: {product.stock_quantity} · mínimo {product.minimum_stock}
                    </span>
                  </div>
                  <div className="product-actions">
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => startEditing(product)}
                      disabled={saving}
                    >
                      Editar
                    </button>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => {
                        setSelectedProductId(product.id)
                        setMovementType('entry')
                      }}
                      disabled={saving}
                    >
                      Mover stock
                    </button>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => void toggleProduct(product)}
                      disabled={saving}
                    >
                      {product.is_active ? 'Eliminar' : 'Restaurar'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>}

      {section === 'stock' && <form className="movement-form" onSubmit={registerMovement}>
        <div>
          <p className="eyebrow">BITÁCORA DE STOCK</p>
          <h4>Registrar entrada o salida</h4>
        </div>
        <label className="field">
          <span>Producto</span>
          <select
            value={selectedProductId}
            onChange={(event) => setSelectedProductId(event.target.value)}
            required
            disabled={saving || products.length === 0}
          >
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} · {product.stock_quantity} disponibles
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Movimiento</span>
          <select
            value={movementType}
            onChange={(event) => setMovementType(event.target.value as InventoryMovement)}
            disabled={saving}
          >
            <option value="entry">Entrada</option>
            <option value="exit">Salida / merma</option>
          </select>
        </label>
        <label className="field">
          <span>Cantidad</span>
          <input
            type="number"
            min="1"
            step="1"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            required
            disabled={saving}
          />
        </label>
        <label className="field">
          <span>Motivo</span>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={240}
            placeholder="Compra, merma, ajuste…"
            required
            disabled={saving}
          />
        </label>
        <button
          className="primary-button"
          type="submit"
          disabled={saving || products.length === 0}
        >
          {saving ? 'Registrando…' : 'Registrar movimiento'}
        </button>
      </form>}

      {(section === 'overview' || section === 'movements') && <div className="movement-history">
        <div className="inventory-heading">
          <div>
            <p className="eyebrow">TRAZABILIDAD</p>
            <h4>Movimientos recientes</h4>
          </div>
          <span>
            {section === 'overview'
              ? `Últimos ${Math.min(movements.length, 5)} movimientos`
              : `${movements.length} movimientos`}
          </span>
        </div>
        {movements.length === 0 ? (
          <p className="table-message">Todavía no hay movimientos registrados.</p>
        ) : (
          <div className="movement-list">
            {(section === 'overview' ? movements.slice(0, 5) : movements).map((movement) => {
              const product = movement.products[0]
              return (
                <article className="movement-row" key={movement.id}>
                  <span className={`movement-badge movement-${movement.movement_type}`}>
                    {movement.movement_type === 'entry'
                      ? 'Entrada'
                      : movement.movement_type === 'sale'
                        ? 'Venta'
                        : 'Salida'}
                  </span>
                  <div>
                    <strong>{product?.name ?? 'Producto'}</strong>
                    <span>
                      SKU {product?.sku ?? '—'} · {movement.reason}
                    </span>
                    <span>{formatDate(movement.created_at)}</span>
                  </div>
                  <strong>
                    {movement.movement_type === 'entry' ? '+' : '−'}
                    {movement.quantity}
                  </strong>
                </article>
              )
            })}
          </div>
        )}
      </div>}
    </section>
  )
}

export function ClientStore({
  clientId,
  section,
  onCartCountChange,
}: {
  clientId: string
  section: ClientStoreSection
  onCartCountChange: Dispatch<SetStateAction<number>>
}) {
  const [products, setProducts] = useState<Product[]>([])
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [cart, setCart] = useState<CartItem[]>([])
  const [loading, setLoading] = useState(true)
  const [buyingProductId, setBuyingProductId] = useState('')
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [errorMessage, setErrorMessage] = useState('')
  const [notice, setNotice] = useState('')

  async function loadStore() {
    if (!supabase) throw new Error('Supabase no está configurado.')
    const [productResult, orderResult] = await Promise.all([
      supabase
        .from('products')
        .select(
          'id, sku, name, description, price, stock_quantity, minimum_stock, is_active',
        )
        .eq('is_active', true)
        .order('name'),
      supabase
        .from('orders')
        .select('id, total, created_at, order_items(product_name, quantity, unit_price)')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(10),
    ])

    if (productResult.error) throw productResult.error
    if (orderResult.error) throw orderResult.error
    setProducts((productResult.data ?? []) as Product[])
    setOrders((orderResult.data ?? []) as PurchaseOrder[])
  }

  useEffect(() => {
    let isCurrent = true

    async function load() {
      try {
        if (!supabase) throw new Error('Supabase no está configurado.')
        const [productResult, orderResult] = await Promise.all([
          supabase
            .from('products')
            .select(
              'id, sku, name, description, price, stock_quantity, minimum_stock, is_active',
            )
            .eq('is_active', true)
            .order('name'),
          supabase
            .from('orders')
            .select(
              'id, total, created_at, order_items(product_name, quantity, unit_price)',
            )
            .eq('client_id', clientId)
            .order('created_at', { ascending: false })
            .limit(10),
        ])

        if (productResult.error) throw productResult.error
        if (orderResult.error) throw orderResult.error
        if (isCurrent) {
          setProducts((productResult.data ?? []) as Product[])
          setOrders((orderResult.data ?? []) as PurchaseOrder[])
        }
      } catch (error) {
        if (isCurrent) setErrorMessage(errorText(error))
      } finally {
        if (isCurrent) setLoading(false)
      }
    }

    void load()
    return () => {
      isCurrent = false
    }
  }, [clientId])

  useEffect(() => {
    onCartCountChange(
      cart.reduce((count, item) => count + item.quantity, 0),
    )
  }, [cart, onCartCountChange])

  function addToCart(product: Product, requestedQuantity: number) {
    if (!Number.isInteger(requestedQuantity) || requestedQuantity < 1) {
      setErrorMessage('Selecciona una cantidad válida.')
      return
    }
    const currentQuantity =
      cart.find((item) => item.product.id === product.id)?.quantity ?? 0
    if (currentQuantity + requestedQuantity > product.stock_quantity) {
      setErrorMessage('La cantidad supera las existencias disponibles.')
      return
    }
    setErrorMessage('')
    setNotice(`${product.name} se agregó al carrito.`)
    setCart((current) => {
      const existing = current.find((item) => item.product.id === product.id)
      if (existing) {
        return current.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + requestedQuantity }
            : item,
        )
      }
      return [...current, { product, quantity: requestedQuantity }]
    })
  }

  function updateCartQuantity(productId: string, nextQuantity: number) {
    const product = products.find((item) => item.id === productId)
    if (!product) return
    if (nextQuantity < 1) {
      setCart((current) => current.filter((item) => item.product.id !== productId))
      return
    }
    if (nextQuantity > product.stock_quantity) {
      setErrorMessage('La cantidad supera las existencias disponibles.')
      return
    }
    setCart((current) =>
      current.map((item) =>
        item.product.id === productId
          ? { ...item, quantity: nextQuantity, product }
          : item,
      ),
    )
    setErrorMessage('')
  }

  async function checkout() {
    if (!supabase) return
    setErrorMessage('')
    setNotice('')
    if (cart.length === 0) {
      setErrorMessage('Agrega al menos un producto antes de confirmar la compra.')
      return
    }
    const unavailableItem = cart.find(
      (item) =>
        !products.some(
          (product) =>
            product.id === item.product.id &&
            product.stock_quantity >= item.quantity,
        ),
    )
    if (unavailableItem) {
      setErrorMessage(
        `No hay existencias suficientes para ${unavailableItem.product.name}. Actualiza el carrito.`,
      )
      return
    }

    setBuyingProductId('checkout')
    try {
      const { data: orderId, error } = await supabase.rpc('place_order', {
        p_items: cart.map((item) => ({
          product_id: item.product.id,
          quantity: item.quantity,
        })),
      })
      if (error) throw error
      setCart([])
      setNotice('Compra realizada correctamente.')
      if (orderId) {
        const { data: savedOrder, error: orderError } = await supabase
          .from('orders')
          .select('total')
          .eq('id', orderId)
          .single()

        if (orderError) {
          setErrorMessage(
            `La compra quedó registrada, pero no se pudo consultar el total final: ${errorText(orderError)}`,
          )
        } else {
          setNotice(
            `Compra realizada correctamente por ${currency.format(savedOrder.total)}.`,
          )
        }
      }
      try {
        await loadStore()
      } catch (error) {
        setErrorMessage(
          `La compra sí quedó registrada, pero no se pudo actualizar la información: ${errorText(error)}`,
        )
      }
    } catch (error) {
      setErrorMessage(errorText(error))
    } finally {
      setBuyingProductId('')
    }
  }

  const cartTotal = cart.reduce(
    (total, item) => total + item.product.price * item.quantity,
    0,
  )

  return (
    <section
      className="store-section"
      aria-labelledby={
        section === 'catalog'
          ? 'store-title'
          : section === 'cart'
            ? 'cart-title'
            : 'orders-title'
      }
    >
      {section === 'catalog' && <>
      <div className="inventory-heading">
        <div>
          <p className="eyebrow">CATÁLOGO DISPONIBLE</p>
          <h3 id="store-title">Comprar productos</h3>
        </div>
      </div>
      {errorMessage && <InventoryFeedback kind="error">{errorMessage}</InventoryFeedback>}
      {notice && <InventoryFeedback kind="success">{notice}</InventoryFeedback>}
      {loading ? (
        <p className="table-message">Cargando productos…</p>
      ) : products.length === 0 ? (
        <p className="table-message">No hay productos disponibles por el momento.</p>
      ) : (
        <div className="store-grid">
          {products.map((product) => (
            <article className="store-product" key={product.id}>
              <span className="store-sku">SKU {product.sku}</span>
              <h4>{product.name}</h4>
              {product.description && <p>{product.description}</p>}
              <span className="store-availability">
                {product.stock_quantity > 0
                  ? `${product.stock_quantity} disponibles`
                  : 'Agotado'}
              </span>
              <div className="store-purchase">
                <strong>{currency.format(product.price)}</strong>
                <label className="store-quantity">
                  <span className="visually-hidden">
                    Cantidad de {product.name}
                  </span>
                  <input
                    aria-label={`Cantidad de ${product.name}`}
                    type="number"
                    min="1"
                    max={product.stock_quantity}
                    step="1"
                    value={quantities[product.id] ?? 1}
                    onChange={(event) =>
                      setQuantities((current) => ({
                        ...current,
                        [product.id]: Number(event.target.value),
                      }))
                    }
                    disabled={Boolean(buyingProductId)}
                  />
                </label>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() =>
                    addToCart(product, quantities[product.id] ?? 1)
                  }
                  disabled={product.stock_quantity === 0 || Boolean(buyingProductId)}
                >
                  {product.stock_quantity === 0 ? 'Agotado' : 'Agregar'}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      </>}

      {section === 'cart' && (
        <div className="cart-section">
          <div className="inventory-heading">
            <div>
              <p className="eyebrow">TU SELECCIÓN</p>
              <h3 id="cart-title">Carrito de compras</h3>
            </div>
          </div>
          {errorMessage && <InventoryFeedback kind="error">{errorMessage}</InventoryFeedback>}
          {notice && <InventoryFeedback kind="success">{notice}</InventoryFeedback>}
          {cart.length === 0 ? (
            <p className="table-message">Tu carrito está vacío. Explora el catálogo para agregar productos.</p>
          ) : (
            <>
              <div className="cart-list">
                {cart.map((item) => (
                  <article className="cart-row" key={item.product.id}>
                    <div>
                      <strong>{item.product.name}</strong>
                      <span>{currency.format(item.product.price)} por unidad</span>
                    </div>
                    <label className="store-quantity">
                      <span className="visually-hidden">
                        Cantidad de {item.product.name}
                      </span>
                      <input
                        aria-label={`Cantidad de ${item.product.name}`}
                        type="number"
                        min="1"
                        max={item.product.stock_quantity}
                        value={item.quantity}
                        onChange={(event) =>
                          updateCartQuantity(item.product.id, Number(event.target.value))
                        }
                        disabled={Boolean(buyingProductId)}
                      />
                    </label>
                    <strong>
                      {currency.format(item.product.price * item.quantity)}
                    </strong>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => updateCartQuantity(item.product.id, 0)}
                      disabled={Boolean(buyingProductId)}
                    >
                      Quitar
                    </button>
                  </article>
                ))}
              </div>
              <div className="cart-checkout">
                <span>Total</span>
                <strong>{currency.format(cartTotal)}</strong>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => void checkout()}
                  disabled={Boolean(buyingProductId)}
                >
                  {buyingProductId ? 'Procesando…' : 'Confirmar compra'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {section === 'orders' && <div className="order-history">
        <div className="inventory-heading">
          <div>
            <p className="eyebrow">ACTIVIDAD DE TU CUENTA</p>
            <h3 id="orders-title">Mis compras</h3>
          </div>
        </div>
        {orders.length === 0 ? (
          <p className="table-message">Tus compras aparecerán aquí.</p>
        ) : (
          <div className="order-list">
            {orders.map((order) => (
              <article className="order-row" key={order.id}>
                <div>
                  <strong>Pedido {order.id.slice(0, 8).toUpperCase()}</strong>
                  <span>{formatDate(order.created_at)}</span>
                  {order.order_items.map((item) => (
                    <span key={`${order.id}-${item.product_name}`}>
                      {item.quantity} × {item.product_name}
                    </span>
                  ))}
                </div>
                <strong>{currency.format(order.total)}</strong>
              </article>
            ))}
          </div>
        )}
      </div>}
    </section>
  )
}

function InventoryFeedback({
  kind,
  children,
}: {
  kind: 'error' | 'success'
  children: string
}) {
  return (
    <p className={`feedback feedback-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  )
}

function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'No fue posible completar la operación. Inténtalo de nuevo.'
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}
