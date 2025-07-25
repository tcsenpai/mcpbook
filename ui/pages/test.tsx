export default function Test() {
  return (
    <div className="min-h-screen bg-blue-500 p-8">
      <h1 className="text-white text-4xl font-bold">
        🎨 CSS Test Page
      </h1>
      <div className="mt-8 bg-white p-6 rounded-lg shadow-lg">
        <h2 className="text-2xl font-semibold text-gray-900 mb-4">
          Testing Tailwind CSS
        </h2>
        <p className="text-gray-600 mb-4">
          If you can see this styled properly, Tailwind is working!
        </p>
        <button className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
          Test Button
        </button>
      </div>
    </div>
  )
}