import { Navigate, Route, Routes, Outlet } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import Navbar from './components/Navbar'
import { LoginPage, RegisterPage } from './pages/AuthPages'
import AddItemPage from './pages/AddItemPage'
import BrowsePage from './pages/BrowsePage'
import MyBookingsPage from './pages/MyBookingsPage'
import MyListingsPage from './pages/MyListingsPage'
import EditItemPage from './pages/EditItemPage'
import ItemDetailsPage from './pages/ItemDetailsPlaceholder'
import BookingDetailsPage from './pages/BookingDetailsPage'
import MessagesPage from './pages/MessagesPage'
import AuthCallbackPage from './pages/AuthCallbackPage'
import HomePage from './pages/HomePage'

function ProtectedLayout() {
  return <><Navbar /><Outlet /></>
}

function PublicLayout() {
  return <><Navbar /><Outlet /></>
}

export default function App() {
  return <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/register" element={<RegisterPage />} />
    <Route path="/auth/callback" element={<AuthCallbackPage />} />
    <Route element={<PublicLayout />}>
      <Route index element={<HomePage />} />
      <Route path="browse" element={<BrowsePage />} />
      <Route path="items/:id" element={<ItemDetailsPage />} />
    </Route>
    <Route element={<ProtectedRoute><ProtectedLayout /></ProtectedRoute>}>
      <Route path="items/new" element={<AddItemPage />} />
      <Route path="items/:id/edit" element={<EditItemPage />} />
      <Route path="bookings/:id" element={<BookingDetailsPage />} />
      <Route path="messages" element={<MessagesPage />} />
      <Route path="bookings" element={<MyBookingsPage />} />
      <Route path="my-listings" element={<MyListingsPage />} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
}
