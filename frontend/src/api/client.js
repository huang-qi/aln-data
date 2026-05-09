import axios from 'axios';

const baseURL = import.meta.env.VITE_API_BASE || '/api';

const api = axios.create({
  baseURL,
  timeout: 30000,
});

api.interceptors.response.use(
  (r) => r,
  (e) => {
    const message = e.response?.data?.detail || e.message || 'Network error';
    return Promise.reject({ ...e, message });
  }
);

export default api;
export { baseURL };
